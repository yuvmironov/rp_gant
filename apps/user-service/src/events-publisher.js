import { getKafkaTopic } from '@rp-gant/service-kit';
import { Kafka, logLevel } from 'kafkajs';

export function startUserOutboxPublisher(db, env = process.env) {
  const kafka = new Kafka({
    clientId: 'user-outbox',
    brokers: String(env.KAFKA_BROKERS ?? 'kafka:9092').split(','),
    logLevel: logLevel.NOTHING,
  });
  const producer = kafka.producer();
  let stopped = false;
  let timer;

  async function publish() {
    if (stopped) return;
    try {
      await producer.connect();
      const result = await db.query(
        `SELECT * FROM events.outbox_events WHERE published_at IS NULL ORDER BY occurred_at ASC LIMIT 50`,
      );
      for (const row of result.rows) {
        const headers = row.headers ?? {};
        await producer.send({
          topic: getKafkaTopic(env),
          messages: [
            {
              key: row.aggregate_id,
              value: JSON.stringify({
                event_id: row.id,
                event_type: row.event_type,
                schema_version: 1,
                occurred_at: new Date(row.occurred_at).toISOString(),
                source_service: 'user',
                actor_user_id: headers.actor_user_id ?? '',
                actor_roles: headers.actor_roles ?? [],
                project_id: headers.project_id ?? '',
                diagram_id: headers.diagram_id ?? '',
                entity_type: headers.entity_type ?? row.aggregate_type,
                entity_id: headers.entity_id ?? row.aggregate_id,
                payload: row.payload ?? {},
              }),
            },
          ],
        });
        await db.query(
          `UPDATE events.outbox_events SET published_at = now(), last_error = NULL WHERE id = $1`,
          [row.id],
        );
      }
    } catch (error) {
      await db
        .query(
          `UPDATE events.outbox_events SET retry_count = retry_count + 1, last_error = $1 WHERE published_at IS NULL`,
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
