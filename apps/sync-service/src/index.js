import { startService } from '@rp-gant/service-kit';
import { buildApp } from './app.js';
import { startSyncConsumer } from './events.js';
import { closePool, createPool } from './db.js';

const db = createPool();
const app = buildApp();
const stopConsumer = await startSyncConsumer(db, process.env, app.metrics).catch((error) => {
  app.log.error(error, 'sync consumer failed to start');
  return async () => {};
});
try {
  await startService(app, { shutdownHooks: [stopConsumer, () => closePool(db)] });
} catch (error) {
  await stopConsumer();
  await closePool(db);
  throw error;
}
