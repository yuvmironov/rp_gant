import { startService } from '@rp-gant/service-kit';
import { buildApp } from './app.js';
import { closePool, createPool } from './db.js';
import { startNotificationConsumer } from './events.js';
import { startNotificationDeliveryWorker } from './delivery-worker.js';
import { createUserClient } from './user-client.js';
import { createAuthEmailImplementation } from './auth-email.js';
import { startAuthEmailDeliveryWorker } from './auth-email-worker.js';
import { startNotificationGrpcServer, createNotificationImplementation } from './grpc.js';

const db = createPool();
const userClient = createUserClient();
const app = buildApp({ db });
const stopConsumer = await startNotificationConsumer(db, userClient).catch((error) => {
  app.log.error(error, 'notification consumer failed to start');
  return async () => {};
});
const stopDelivery = startNotificationDeliveryWorker(db, userClient);
const stopAuthEmailDelivery = startAuthEmailDeliveryWorker(db);
const grpc = await startNotificationGrpcServer({
  port: Number(process.env.GRPC_PORT ?? 50052),
  implementation: createNotificationImplementation(createAuthEmailImplementation({ db })),
});
app.log.info({ grpcPort: grpc.port }, 'notification gRPC server started');

try {
  await startService(app, {
    shutdownHooks: [
      stopConsumer,
      stopDelivery,
      stopAuthEmailDelivery,
      grpc.close,
      () => userClient.close?.(),
      () => closePool(db),
    ],
  });
} catch (error) {
  await stopDelivery();
  await stopAuthEmailDelivery();
  await grpc.close();
  userClient.close?.();
  await closePool(db);
  throw error;
}
