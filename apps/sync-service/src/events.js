import {
  getKafkaConnectionOptions,
  getKafkaTopic,
  runWithDlq,
  withTransaction,
} from '@rp-gant/service-kit';
import { Kafka, logLevel } from 'kafkajs';

export async function startSyncConsumer(db, env = process.env, metrics) {
  const kafka = new Kafka({
    clientId: 'sync-consumer',
    ...getKafkaConnectionOptions(env),
    logLevel: logLevel.NOTHING,
  });
  const consumer = kafka.consumer({ groupId: env.KAFKA_CONSUMER_GROUP_SYNC ?? 'sync' });
  const producer = kafka.producer();
  try {
    await producer.connect();
    await consumer.connect();
    const topic = getKafkaTopic(env);
    await consumer.subscribe({ topic });
    await consumer.subscribe({ topic: `${topic}.replay.sync`, fromBeginning: true });
    await consumer.run({
      eachMessage: (context) =>
        runWithDlq({
          context,
          producer,
          dlqTopic: `${getKafkaTopic(env)}.dlq.sync`,
          metrics,
          service: 'sync',
          handler: async ({ message }) => {
            if (!message.value) return;
            const event = JSON.parse(message.value.toString());
            await withTransaction(db, async (tx) => {
              const claimed = await tx.query(
                `INSERT INTO events.processed_events (consumer, event_id)
                 VALUES ('sync', $1)
                 ON CONFLICT DO NOTHING
                 RETURNING event_id`,
                [event.event_id],
              );
              if (claimed.rowCount === 0) return;

              const response = await fetch(
                `${env.SYNC_SERVICE_URL ?? 'http://127.0.0.1:8080'}/internal/broadcast`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ type: 'diagram.changed', event }),
                },
              );
              if (!response.ok) throw new Error(`sync_broadcast_http_${response.status}`);
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
