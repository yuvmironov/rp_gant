import { afterEach, describe, expect, it } from 'vitest';
import { createService, loadConfig } from '../src/index.js';

const apps = [];

function buildApp(routes) {
  const app = createService({
    name: 'test-service',
    version: '1.0.0',
    logger: false,
    config: {
      host: '127.0.0.1',
      logLevel: 'silent',
      nodeEnv: 'test',
      port: 0,
    },
    routes,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('service-kit', () => {
  it('serves liveness and readiness', async () => {
    const app = buildApp();

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ status: 'ok', service: 'test-service' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ready', service: 'test-service' });
  });

  it('keeps a client request id and returns it in the response', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'req-test-1' },
    });

    expect(response.headers['x-request-id']).toBe('req-test-1');
  });

  it('returns RFC 7807 for unknown routes', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      status: 404,
      code: 'not_found',
      instance: '/missing',
    });
  });

  it('does not expose internal error details', async () => {
    const app = buildApp((instance, _options, done) => {
      instance.get('/boom', async () => {
        throw new Error('database password leaked');
      });
      done();
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      status: 500,
      code: 'internal_error',
      detail: 'Internal server error',
    });
    expect(response.body).not.toContain('password');
  });

  it('exposes Prometheus metrics', async () => {
    const app = buildApp();
    app.metrics.outboxPending.set({ service: 'user' }, 42);
    app.metrics.outboxRetries.set({ service: 'user' }, 3);
    app.metrics.outboxPublishErrors.inc({ service: 'user' });
    app.metrics.eventsProcessed.inc({ service: 'audit' });
    app.metrics.eventsFailed.inc({ service: 'audit' });
    app.metrics.dlqMessages.inc({ service: 'audit' });
    app.metrics.eventProcessingLag.observe({ service: 'audit' }, 7.25);
    const response = await app.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('http_requests_total');
    expect(response.body).toContain('outbox_pending{service="user"} 42');
    expect(response.body).toContain('outbox_events_retry_count_gt_3{service="user"} 3');
    expect(response.body).toContain('outbox_publish_errors_total{service="user"} 1');
    expect(response.body).toContain('events_processed_total{service="audit"} 1');
    expect(response.body).toContain('events_failed_total{service="audit"} 1');
    expect(response.body).toContain('dlq_messages_total{service="audit"} 1');
    expect(response.body).toContain('event_processing_lag_seconds_count{service="audit"} 1');
    expect(response.body).toContain('rp_gant_process_cpu_user_seconds_total');
  });

  it('rejects invalid port configuration', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow('invalid_port');
  });
});
