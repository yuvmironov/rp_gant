import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps = [];

function app() {
  const instance = buildApp({
    env: { PORT: '8080', LOG_LEVEL: 'silent', NODE_ENV: 'test' },
    logger: false,
  });
  apps.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((instance) => instance.close()));
});

describe('api-gateway', () => {
  it('requires a configured sync signing secret in production', () => {
    expect(() => buildApp({ env: { NODE_ENV: 'production' }, logger: false })).toThrow(
      'sync_token_secret_required',
    );
  });

  it('serves the versioned health endpoint', async () => {
    const response = await app().inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'api-gateway',
      version: '0.1.0',
    });
  });

  it('serves infrastructure health endpoints', async () => {
    const instance = app();

    const live = await instance.inject({ method: 'GET', url: '/health/live' });
    const ready = await instance.inject({ method: 'GET', url: '/health/ready' });

    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
  });

  it('returns RFC 7807 for unknown API routes', async () => {
    const response = await app().inject({ method: 'GET', url: '/api/v1/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });
});
