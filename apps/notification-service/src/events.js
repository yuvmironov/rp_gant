import {
  getKafkaConnectionOptions,
  getKafkaTopic,
  runWithDlq,
  withTransaction,
} from '@rp-gant/service-kit';
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

export async function startNotificationConsumer(db, userClient, env = process.env, metrics) {
  const kafka = new Kafka({
    clientId: 'notification-consumer',
    ...getKafkaConnectionOptions(env),
    logLevel: logLevel.NOTHING,
  });
  const consumer = kafka.consumer({
    groupId: env.KAFKA_CONSUMER_GROUP_NOTIFICATION ?? 'notification',
  });
  const producer = kafka.producer();
  try {
    await producer.connect();
    await consumer.connect();
    const topic = getKafkaTopic(env);
    await consumer.subscribe({ topic });
    await consumer.subscribe({ topic: `${topic}.replay.notification`, fromBeginning: true });

    await consumer.run({
      eachMessage: (context) =>
        runWithDlq({
          context,
          producer,
          dlqTopic: `${getKafkaTopic(env)}.dlq.notification`,
          metrics,
          service: 'notification',
          handler: async ({ message }) => {
            if (!message.value) return;
            const event = JSON.parse(message.value.toString());
            await withTransaction(db, async (tx) => {
              const seen = await tx.query(
                `SELECT 1 FROM events.processed_events WHERE consumer = 'notification' AND event_id = $1`,
                [event.event_id],
              );
              if (seen.rowCount > 0) return;

              if (event.event_type === 'task.assignments.changed') {
                for (const assignment of event.payload?.assignments ?? []) {
                  const assigneeType = assignment.assigneeType ?? assignment.assignee_type;
                  const assigneeId = assignment.assigneeId ?? assignment.assignee_id;
                  const role = assignment.role;
                  if (
                    !['user', 'ASSIGNEE_TYPE_USER'].includes(assigneeType) ||
                    ![
                      'executor',
                      'co_executor',
                      'ASSIGNMENT_ROLE_EXECUTOR',
                      'ASSIGNMENT_ROLE_CO_EXECUTOR',
                    ].includes(role)
                  ) {
                    continue;
                  }
                  await tx.query(
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
                  await tx.query(
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
              await tx.query(
                `INSERT INTO events.processed_events (consumer, event_id) VALUES ('notification', $1)
               ON CONFLICT DO NOTHING`,
                [event.event_id],
              );
            });
          },
        }),
    });
  } catch (error) {
    await Promise.allSettled([consumer.disconnect(), producer.disconnect()]);
    throw error;
  }

  return async () => {
    await Promise.allSettled([consumer.disconnect(), producer.disconnect()]);
  };
}
