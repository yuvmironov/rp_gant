import { randomUUID } from 'node:crypto';
import { getKafkaTopic } from '@rp-gant/service-kit';
import { Kafka, logLevel } from 'kafkajs';

export async function startAuditConsumer(db, env = process.env) {
  const kafka = new Kafka({
    clientId: 'audit-consumer',
    brokers: String(env.KAFKA_BROKERS ?? 'kafka:9092').split(','),
    logLevel: logLevel.NOTHING,
  });
  const consumer = kafka.consumer({
    groupId: env.KAFKA_CONSUMER_GROUP_AUDIT ?? 'audit',
  });
  await consumer.connect();
  await consumer.subscribe({ topic: getKafkaTopic(env) });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const event = JSON.parse(message.value.toString());
      const seen = await db.query(
        `SELECT 1 FROM events.processed_events WHERE consumer = 'audit' AND event_id = $1`,
        [event.event_id],
      );
      if (seen.rowCount > 0) return;
      const action = await db.query(`SELECT severity FROM audit.audit_actions WHERE code = $1`, [
        event.event_type,
      ]);
      if (action.rowCount === 0) return;
      await db.query(
        `INSERT INTO audit.audit_events
           (id, occurred_at, actor_user_id, actor_type, actor_roles, action_code,
            entity_type, entity_id, project_id, diagram_id, source_event_id,
            source_service, severity, metadata)
         VALUES ($1, $2, NULLIF($3, '')::uuid, 'user', $4::jsonb, $5, $6,
                 NULLIF($7, '')::uuid, NULLIF($8, '')::uuid, NULLIF($9, '')::uuid,
                 $10, $11, $12, $13::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          randomUUID(),
          new Date(event.occurred_at),
          event.actor_user_id ?? '',
          JSON.stringify(event.actor_roles ?? []),
          event.event_type,
          event.entity_type ?? null,
          event.entity_id ?? '',
          event.project_id ?? '',
          event.diagram_id ?? '',
          event.event_id,
          event.source_service ?? 'project',
          action.rows[0].severity,
          JSON.stringify(event.payload ?? {}),
        ],
      );
      await db.query(
        `INSERT INTO events.processed_events (consumer, event_id) VALUES ('audit', $1)
         ON CONFLICT DO NOTHING`,
        [event.event_id],
      );
    },
  });

  return async () => consumer.disconnect();
}
