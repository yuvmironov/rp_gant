import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { signSyncToken } from '@rp-gant/shared';
import { buildApp } from '../src/app.js';

const secret = 'test-sync-secret';
const apps = [];
const sockets = [];

function makeApp() {
  const app = buildApp({
    env: { PORT: '18080', LOG_LEVEL: 'silent', SYNC_TOKEN_SECRET: secret },
    logger: false,
  });
  apps.push(app);
  return app;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error('ws timeout')), 5000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function nextEvent(socket) {
  return new Promise((resolve) => {
    const handler = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'diagram.changed') {
        socket.off('message', handler);
        resolve(message);
      }
    };
    socket.on('message', handler);
  });
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('sync service', () => {
  it('requires a configured sync signing secret in production', () => {
    expect(() => buildApp({ env: { NODE_ENV: 'production' }, logger: false })).toThrow(
      'sync_token_secret_required',
    );
  });

  it('rejects connections without a valid token', async () => {
    const app = makeApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address();
    await expect(connect(`ws://127.0.0.1:${port}/ws`)).rejects.toBeTruthy();
  });

  it('filters events by project scope', async () => {
    const app = makeApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address();
    const tokenA = signSyncToken({ userId: 'a', projectIds: ['project-a'], secret }).token;
    const tokenB = signSyncToken({ userId: 'b', projectIds: ['project-b'], secret }).token;
    const socketA = await connect(`ws://127.0.0.1:${port}/ws?token=${tokenA}`);
    const socketB = await connect(`ws://127.0.0.1:${port}/ws?token=${tokenB}`);

    let bReceived = false;
    socketB.on('message', (raw) => {
      if (JSON.parse(raw.toString()).type === 'diagram.changed') bReceived = true;
    });
    const eventPromise = nextEvent(socketA);
    const response = await fetch(`http://127.0.0.1:${port}/internal/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'diagram.changed',
        event: { project_id: 'project-a', entity_type: 'task' },
      }),
    });
    expect(await response.json()).toEqual({ delivered: 1 });
    await expect(eventPromise).resolves.toMatchObject({
      event: { project_id: 'project-a' },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(bReceived).toBe(false);

    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    const body = await metrics.text();
    expect(body).toContain('sync_ws_connections_active');
    expect(body).toContain('sync_events_sent_total');
  });
});
