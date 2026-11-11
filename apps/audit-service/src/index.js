import { startService } from '@rp-gant/service-kit';
import { buildApp } from './app.js';
import { closePool, createPool } from './db.js';
import { startAuditConsumer } from './events.js';

const db = createPool();
const app = buildApp({ db });
const stopConsumer = await startAuditConsumer(db, process.env, app.metrics).catch((error) => {
  app.log.error(error, 'audit consumer failed to start');
  return async () => {};
});

try {
  await startService(app, {
    shutdownHooks: [stopConsumer, () => closePool(db)],
  });
} catch (error) {
  await stopConsumer();
  await closePool(db);
  throw error;
}
