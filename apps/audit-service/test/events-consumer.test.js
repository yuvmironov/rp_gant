import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMetrics } from '@rp-gant/service-kit';

const mocks = vi.hoisted(() => ({
  producer: { connect: vi.fn(), send: vi.fn(), disconnect: vi.fn() },
  consumer: {
    connect: vi.fn(),
    subscribe: vi.fn(),
    run: vi.fn(),
    disconnect: vi.fn(),
  },
  eachMessage: undefined,
}));

vi.mock('kafkajs', () => ({
  Kafka: class {
    producer() {
      return mocks.producer;
    }

    consumer() {
      return mocks.consumer;
    }
  },
  logLevel: { NOTHING: 0 },
}));

import { startAuditConsumer } from '../src/events.js';

describe('audit consumer DLQ wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.producer.connect.mockResolvedValue(undefined);
    mocks.producer.send.mockResolvedValue(undefined);
    mocks.producer.disconnect.mockResolvedValue(undefined);
    mocks.consumer.connect.mockResolvedValue(undefined);
    mocks.consumer.subscribe.mockResolvedValue(undefined);
    mocks.consumer.disconnect.mockResolvedValue(undefined);
    mocks.consumer.run.mockImplementation(async ({ eachMessage }) => {
      mocks.eachMessage = eachMessage;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('commits a processed audit event before allowing Kafka to commit its offset', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (sql === 'SELECT severity FROM audit.audit_actions WHERE code = $1') {
          return { rowCount: 1, rows: [{ severity: 'info' }] };
        }
        if (sql.startsWith('SELECT 1 FROM events.processed_events')) {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };
    const db = { connect: vi.fn().mockResolvedValue(client) };
    const metrics = createMetrics();
    const stop = await startAuditConsumer(
      db,
      { KAFKA_BROKERS: 'localhost:9092', KAFKA_TOPIC: 'test.events' },
      metrics,
    );

    await mocks.eachMessage({
      topic: 'test.events',
      partition: 0,
      message: {
        key: Buffer.from('aggregate'),
        offset: '7',
        value: Buffer.from(
          JSON.stringify({
            event_id: 'event-id',
            event_type: 'task.updated',
            occurred_at: '2026-11-11T12:00:00.000Z',
            payload: {},
          }),
        ),
      },
    });

    expect(mocks.consumer.subscribe).toHaveBeenNthCalledWith(1, { topic: 'test.events' });
    expect(mocks.consumer.subscribe).toHaveBeenNthCalledWith(2, {
      topic: 'test.events.replay.audit',
      fromBeginning: true,
    });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      "SELECT 1 FROM events.processed_events WHERE consumer = 'audit' AND event_id = $1",
      'SELECT severity FROM audit.audit_actions WHERE code = $1',
      expect.stringContaining('INSERT INTO audit.audit_events'),
      expect.stringContaining(
        "INSERT INTO events.processed_events (consumer, event_id) VALUES ('audit', $1)",
      ),
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
    expect(mocks.producer.send).not.toHaveBeenCalled();
    expect(await metrics.registry.metrics()).toContain('events_processed_total{service="audit"} 1');

    await stop();
    expect(mocks.consumer.disconnect).toHaveBeenCalledOnce();
    expect(mocks.producer.disconnect).toHaveBeenCalledOnce();
  });
});
