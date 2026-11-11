import { verifySyncToken } from '@rp-gant/shared';
import { createService, getSyncTokenSecret, loadConfig } from '@rp-gant/service-kit';
import { Counter, Gauge } from 'prom-client';
import { WebSocketServer } from 'ws';

const serviceName = 'sync-service';
const serviceVersion = '0.1.0';

function rejectUpgrade(socket, status, reason) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function buildApp({ env = process.env, logger = true } = {}) {
  const config = loadConfig(env, {
    logLevel: env.LOG_LEVEL ?? 'info',
    port: 8080,
  });
  const secret = getSyncTokenSecret(env);

  const wss = new WebSocketServer({ noServer: true });
  const app = createService({
    name: serviceName,
    version: serviceVersion,
    config,
    logger,
    routes: async (instance) => {
      instance.post('/internal/broadcast', async (request) => {
        const body = request.body ?? {};
        const projectId = String(body.event?.project_id ?? '');
        let delivered = 0;
        for (const client of wss.clients) {
          if (client.readyState !== 1) continue;
          if (!client.projects?.has('*') && (!projectId || !client.projects?.has(projectId))) {
            continue;
          }
          client.send(JSON.stringify(body));
          delivered += 1;
        }
        eventsSent.inc(delivered);
        return { delivered };
      });
    },
  });

  const activeConnections = new Gauge({
    name: 'sync_ws_connections_active',
    help: 'Active authenticated sync WebSocket connections',
    registers: [app.metrics.registry],
  });
  const authFailures = new Counter({
    name: 'sync_ws_auth_failures_total',
    help: 'Rejected sync WebSocket handshakes',
    registers: [app.metrics.registry],
  });
  const eventsSent = new Counter({
    name: 'sync_events_sent_total',
    help: 'Realtime events delivered to clients',
    registers: [app.metrics.registry],
  });

  app.server.on('upgrade', (request, socket, head) => {
    let token;
    try {
      token = new URL(request.url ?? '/', 'http://sync.rp-gant.localhost').searchParams.get(
        'token',
      );
    } catch {
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }
    const claims = verifySyncToken(token, secret);
    if (!claims) {
      authFailures.inc();
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      client.userId = claims.sub;
      client.projects = new Set(claims.projects);
      client.tokenExpiresAt = claims.exp;
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', (client) => {
    activeConnections.inc();
    client.send(JSON.stringify({ type: 'connected', service: serviceName }));
    const expiresInMs = Math.max(0, client.tokenExpiresAt * 1000 - Date.now());
    const expiryTimer = setTimeout(() => client.close(4001, 'token_expired'), expiresInMs);
    client.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'ping') {
          client.send(JSON.stringify({ type: 'pong', at: new Date().toISOString() }));
        }
      } catch {
        client.send(JSON.stringify({ type: 'error', code: 'invalid_message' }));
      }
    });
    client.on('close', () => {
      activeConnections.dec();
      clearTimeout(expiryTimer);
    });
  });

  app.addHook('onClose', async () => {
    await new Promise((resolve) => wss.close(resolve));
  });

  return app;
}
