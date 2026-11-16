import {
  getKafkaConnectionOptions,
  getKafkaTopic,
  runWithDlq,
  withTransaction,
} from '@rp-gant/service-kit';
import { Kafka, logLevel } from 'kafkajs';

export async function processProjectEvent(tx, event) {
  const seen = await tx.query(
    `SELECT 1 FROM events.processed_events WHERE consumer = 'project' AND event_id = $1`,
    [event.event_id],
  );
  if (seen.rowCount > 0) return;

  if (event.event_type === 'user.deleted') {
    const userId = String(event.payload?.userId ?? event.payload?.user_id ?? '');
    if (!userId) throw new Error('user_deleted_event_missing_user_id');
    await tx.query(
      `DELETE FROM plan.assignments
       WHERE assignee_type = 'user' AND assignee_id = $1::uuid`,
      [userId],
    );
    await tx.query(
      `UPDATE plan.comments
       SET author_user_id = CASE WHEN author_user_id = $1::uuid THEN NULL ELSE author_user_id END,
           mentioned_user_ids = array_remove(mentioned_user_ids, $1::uuid),
           updated_at = now()
       WHERE author_user_id = $1::uuid OR $1::uuid = ANY(mentioned_user_ids)`,
      [userId],
    );
  }

  await tx.query(
    `INSERT INTO events.processed_events (consumer, event_id) VALUES ('project', $1)
     ON CONFLICT DO NOTHING`,
    [event.event_id],
  );
}

export async function startProjectConsumer(db, env = process.env, metrics) {
  const kafka = new Kafka({
    clientId: 'project-consumer',
    ...getKafkaConnectionOptions(env),
    logLevel: logLevel.NOTHING,
  });
  const consumer = kafka.consumer({
    groupId: env.KAFKA_CONSUMER_GROUP_PROJECT ?? 'project',
  });
  const producer = kafka.producer();
  try {
    await producer.connect();
    await consumer.connect();
    const topic = getKafkaTopic(env);
    await consumer.subscribe({ topic });
    await consumer.subscribe({ topic: `${topic}.replay.project`, fromBeginning: true });
    await consumer.run({
      eachMessage: (context) =>
        runWithDlq({
          context,
          producer,
          dlqTopic: `${topic}.dlq.project`,
          metrics,
          service: 'project',
          handler: async ({ message }) => {
            if (!message.value) return;
            const event = JSON.parse(message.value.toString());
            await withTransaction(db, (tx) => processProjectEvent(tx, event));
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
