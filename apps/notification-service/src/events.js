import { getKafkaTopic } from '@rp-gant/service-kit';
import { Kafka, logLevel } from 'kafkajs';

export async function enqueueDeliveries(db, notificationId, userId, eventType) {
  const prefs = await db.query(
    `SELECT channel, enabled FROM notify.notification_preferences
     WHERE user_id = $1 AND event_type = $2`,
    [userId, eventType],
  );
  const configured = new Map(prefs.rows.map((row) => [row.channel, row.enabled]));
  const channels = [
    ['internal', configured.has('internal') ? configured.get('internal') : true],
    ['email', configured.has('email') ? configured.get('email') : true],
    ['telegram', configured.has('telegram') ? configured.get('telegram') : false],
  ];
  for (const [channel, enabled] of channels) {
    if (!enabled) continue;
    await db.query(
      `INSERT INTO delivery.notification_deliveries (notification_id, channel)
       VALUES ($1, $2) ON CONFLICT (notification_id, channel) DO NOTHING`,
      [notificationId, channel],
    );
  }
}

export async function startNotificationConsumer(db, userClient, env = process.env) {
  const kafka = new Kafka({
    clientId: 'notification-consumer',
    brokers: String(env.KAFKA_BROKERS ?? 'kafka:9092').split(','),
    logLevel: logLevel.NOTHING,
  });
  const consumer = kafka.consumer({
    groupId: env.KAFKA_CONSUMER_GROUP_NOTIFICATION ?? 'notification',
  });
  await consumer.connect();
  await consumer.subscribe({ topic: getKafkaTopic(env) });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const event = JSON.parse(message.value.toString());
      const seen = await db.query(
        `SELECT 1 FROM events.processed_events WHERE consumer = 'notification' AND event_id = $1`,
        [event.event_id],
      );
      if (seen.rowCount > 0) return;

      if (event.event_type === 'task.assignments.changed') {
        for (const assignment of event.payload?.assignments ?? []) {
          const assigneeType = assignment.assigneeType ?? assignment.assignee_type;
          const assigneeId = assignment.assigneeId ?? assignment.assignee_id;
          if (!['user', 'ASSIGNEE_TYPE_USER'].includes(assigneeType)) continue;
          await db.query(
            `INSERT INTO notify.notifications
               (recipient_user_id, project_id, diagram_id, event_type, title, body,
                entity_type, entity_id, payload)
             VALUES ($1, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid,
                     'task.assigned', 'Вам назначена задача',
                     'Проверьте назначение в Gantt-диаграмме', 'task',
                     NULLIF($4, '')::uuid, $5)`,
            [
              assigneeId,
              event.project_id,
              event.diagram_id,
              event.entity_id,
              { eventId: event.event_id, role: assignment.role },
            ],
          );
        }
      }
      if (event.event_type === 'comment.created') {
        for (const userId of event.payload?.mentionedUserIds ?? []) {
          await db.query(
            `INSERT INTO notify.notifications
               (recipient_user_id, project_id, diagram_id, event_type, title, body,
                entity_type, entity_id, payload)
             VALUES ($1, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid,
                     'comment.mentioned', 'Вас упомянули в комментарии',
                     $4, $5, NULLIF($6, '')::uuid, $7)`,
            [
              userId,
              event.project_id,
              event.diagram_id,
              String(event.payload?.bodyPreview ?? '').slice(0, 200),
              event.payload?.entityType ?? '',
              event.payload?.entityId ?? '',
              { eventId: event.event_id },
            ],
          );
        }
      }
      await db.query(
        `INSERT INTO events.processed_events (consumer, event_id) VALUES ('notification', $1)
         ON CONFLICT DO NOTHING`,
        [event.event_id],
      );
    },
  });

  return async () => consumer.disconnect();
}
