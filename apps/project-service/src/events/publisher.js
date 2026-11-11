import { getKafkaConnectionOptions, getKafkaTopic } from '@rp-gant/service-kit';
import { Kafka, logLevel } from 'kafkajs';

export function startOutboxPublisher(db, env = process.env, metrics) {
  const topic = getKafkaTopic(env);
  const kafka = new Kafka({
    clientId: 'project-outbox',
    ...getKafkaConnectionOptions(env),
    logLevel: logLevel.NOTHING,
  });
  const producer = kafka.producer();
  let stopped = false;
  let timer;

  async function publish() {
    if (stopped) return;
    try {
      const outboxStats = await db.query(
        `SELECT count(*) AS pending,
                count(*) FILTER (WHERE retry_count > 3) AS retry_exceeded
         FROM events.outbox_events
         WHERE published_at IS NULL`,
      );
      metrics?.outboxPending.set({ service: 'project' }, Number(outboxStats.rows[0]?.pending ?? 0));
      metrics?.outboxRetries.set(
        { service: 'project' },
        Number(outboxStats.rows[0]?.retry_exceeded ?? 0),
      );
      await producer.connect();
      const result = await db.query(
        `SELECT * FROM events.outbox_events
         WHERE published_at IS NULL
         ORDER BY occurred_at ASC
         LIMIT 50`,
      );
      for (const row of result.rows) {
        const headers = row.headers ?? {};
        const envelope = {
          event_id: row.id,
          event_type: row.event_type,
          schema_version: 1,
          occurred_at: new Date(row.occurred_at).toISOString(),
          source_service: 'project',
          actor_user_id: headers.actor_user_id ?? '',
          actor_roles: headers.actor_roles ?? [],
          project_id: headers.project_id ?? '',
          diagram_id: headers.diagram_id ?? '',
          entity_type: headers.entity_type ?? row.aggregate_type,
          entity_id: headers.entity_id ?? row.aggregate_id,
          payload: row.payload ?? {},
        };
        await producer.send({
          topic,
          messages: [{ key: row.aggregate_id, value: JSON.stringify(envelope) }],
        });
        await db.query(
          `UPDATE events.outbox_events SET published_at = now(), last_error = NULL WHERE id = $1`,
          [row.id],
        );
      }
    } catch (error) {
      metrics?.outboxPublishErrors.inc({ service: 'project' });
      await db
        .query(
          `UPDATE events.outbox_events
           SET retry_count = retry_count + 1, last_error = $1
           WHERE published_at IS NULL`,
          [String(error.message ?? error).slice(0, 500)],
        )
        .catch(() => {});
    }
  }

  timer = setInterval(publish, 1500);
  publish();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await producer.disconnect().catch(() => {});
  };
}
