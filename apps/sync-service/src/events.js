import { getKafkaTopic } from '@rp-gant/service-kit';
import { Kafka, logLevel } from 'kafkajs';

export async function startSyncConsumer(env = process.env) {
  const kafka = new Kafka({
    clientId: 'sync-consumer',
    brokers: String(env.KAFKA_BROKERS ?? 'kafka:9092').split(','),
    logLevel: logLevel.NOTHING,
  });
  const consumer = kafka.consumer({ groupId: env.KAFKA_CONSUMER_GROUP_SYNC ?? 'sync' });
  await consumer.connect();
  await consumer.subscribe({ topic: getKafkaTopic(env) });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const event = JSON.parse(message.value.toString());
      await fetch(`${env.SYNC_SERVICE_URL ?? 'http://127.0.0.1:8080'}/internal/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'diagram.changed', event }),
      }).catch(() => {});
    },
  });
  return async () => consumer.disconnect();
}
