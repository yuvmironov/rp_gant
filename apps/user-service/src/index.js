import { startService } from '@rp-gant/service-kit';
import { buildApp } from './app.js';
import { createUserImplementation, ensureDevAdmin } from './auth.js';
import { closePool, createPool } from './db.js';
import { startUserOutboxPublisher } from './events-publisher.js';
import { startUserGrpcServer } from './grpc.js';
import { createNotificationClient } from './notification-client.js';
import { startAuthEmailJobWorker } from './auth-email-worker.js';

const app = buildApp();
const db = createPool();
const notificationClient = createNotificationClient();
const stopAuthEmailJobs = startAuthEmailJobWorker(db, notificationClient, app.log);
if (await ensureDevAdmin(db)) {
  app.log.info('initial admin is ready');
}
const stopOutbox = startUserOutboxPublisher(db);
const grpc = await startUserGrpcServer({
  port: Number(process.env.GRPC_PORT ?? 50051),
  implementation: createUserImplementation({
    db,
    devAutoVerify: process.env.DEV_AUTO_VERIFY === 'true',
  }),
});
app.log.info({ grpcPort: grpc.port }, 'gRPC server started');

try {
  await startService(app, {
    shutdownHooks: [
      stopOutbox,
      stopAuthEmailJobs,
      grpc.close,
      () => notificationClient.close(),
      () => closePool(db),
    ],
  });
} catch (error) {
  await stopOutbox();
  await stopAuthEmailJobs();
  await grpc.close();
  notificationClient.close();
  await closePool(db);
  throw error;
}
