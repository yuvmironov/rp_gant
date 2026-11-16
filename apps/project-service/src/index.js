import { startService } from '@rp-gant/service-kit';
import { buildApp } from './app.js';
import { closePool, createPool } from './db.js';
import { startProjectGrpcServer } from './grpc.js';
import { createProjectImplementation } from './projects.js';
import { createUserClient } from './user-client.js';
import { startOutboxPublisher } from './events/publisher.js';
import { startProjectConsumer } from './events/consumer.js';

const app = buildApp();
const db = createPool();
const userClient = createUserClient({
  address: process.env.USER_SERVICE_GRPC ?? 'localhost:50051',
});
const grpc = await startProjectGrpcServer({
  port: Number(process.env.GRPC_PORT ?? 50051),
  implementation: createProjectImplementation({ db, userClient }),
});
app.log.info({ grpcPort: grpc.port }, 'gRPC server started');
const stopOutbox = startOutboxPublisher(db, process.env, app.metrics);
const stopConsumer = await startProjectConsumer(db, process.env, app.metrics).catch((error) => {
  app.log.error(error, 'project consumer failed to start');
  return async () => {};
});

try {
  await startService(app, {
    shutdownHooks: [
      stopConsumer,
      stopOutbox,
      grpc.close,
      () => closePool(db),
      () => userClient.close(),
    ],
  });
} catch (error) {
  await stopConsumer();
  await stopOutbox();
  await grpc.close();
  await closePool(db);
  userClient.close();
  throw error;
}
