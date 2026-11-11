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

import { startSyncConsumer } from '../src/events.js';

function createDb({ alreadyProcessed = false } = {}) {
  const client = {
    query: vi.fn(async (sql) => {
      if (sql.startsWith('INSERT INTO events.processed_events')) {
        return { rowCount: alreadyProcessed ? 0 : 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  return { db: { connect: vi.fn().mockResolvedValue(client) }, client };
}

describe('sync consumer DLQ wiring', () => {
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('acknowledges a broadcast only after the Sync Service accepts it', async () => {
    const metrics = createMetrics();
    const { db, client } = createDb();
    const stop = await startSyncConsumer(
      db,
      { KAFKA_BROKERS: 'localhost:9092', KAFKA_TOPIC: 'test.events' },
      metrics,
    );
    const event = {
      event_id: '11111111-1111-4111-8111-111111111111',
      event_type: 'diagram.updated',
    };

    await mocks.eachMessage({
      topic: 'test.events',
      partition: 0,
      message: {
        key: Buffer.from('project-id'),
        offset: '15',
        value: Buffer.from(JSON.stringify(event)),
      },
    });

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO events.processed_events'),
      'COMMIT',
    ]);
    expect(mocks.consumer.subscribe).toHaveBeenNthCalledWith(1, { topic: 'test.events' });
    expect(mocks.consumer.subscribe).toHaveBeenNthCalledWith(2, {
      topic: 'test.events.replay.sync',
      fromBeginning: true,
    });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8080/internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'diagram.changed', event }),
    });
    expect(mocks.producer.send).not.toHaveBeenCalled();
    expect(await metrics.registry.metrics()).toContain('events_processed_total{service="sync"} 1');

    await stop();
    expect(mocks.consumer.disconnect).toHaveBeenCalledOnce();
    expect(mocks.producer.disconnect).toHaveBeenCalledOnce();
  });

  it('retries a failed broadcast five times, then writes it to the DLQ', async () => {
    vi.useFakeTimers();
    const metrics = createMetrics();
    const { db, client } = createDb();
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 });
    const stop = await startSyncConsumer(
      db,
      { KAFKA_BROKERS: 'localhost:9092', KAFKA_TOPIC: 'test.events' },
      metrics,
    );
    const processing = mocks.eachMessage({
      topic: 'test.events',
      partition: 0,
      message: {
        key: Buffer.from('project-id'),
        offset: '16',
        value: Buffer.from('{"event_id":"22222222-2222-4222-8222-222222222222"}'),
      },
    });

    await vi.advanceTimersByTimeAsync(18_000);
    await expect(processing).resolves.toEqual({ attempts: 5, deadLettered: true });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(await metrics.registry.metrics()).toContain('events_failed_total{service="sync"} 5');
    expect(await metrics.registry.metrics()).toContain('dlq_messages_total{service="sync"} 1');
    expect(mocks.producer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'test.events.dlq.sync' }),
    );
    expect(client.query.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(5);

    await stop();
  });

  it('skips a replay already recorded in the Sync dedup table', async () => {
    const metrics = createMetrics();
    const { db, client } = createDb({ alreadyProcessed: true });
    const stop = await startSyncConsumer(
      db,
      { KAFKA_BROKERS: 'localhost:9092', KAFKA_TOPIC: 'test.events' },
      metrics,
    );

    await mocks.eachMessage({
      topic: 'test.events.replay.sync',
      partition: 0,
      message: {
        key: Buffer.from('project-id'),
        offset: '17',
        value: Buffer.from('{"event_id":"33333333-3333-4333-8333-333333333333"}'),
      },
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO events.processed_events'),
      'COMMIT',
    ]);
    await stop();
  });
});
