import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { startNotificationConsumer } from '../src/events.js';

describe('notification consumer DLQ wiring', () => {
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

  it('commits notification side effects and inbox idempotency together', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.startsWith('SELECT 1 FROM events.processed_events')) {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };
    const db = { connect: vi.fn().mockResolvedValue(client) };
    const metrics = createMetrics();
    const stop = await startNotificationConsumer(
      db,
      {},
      { KAFKA_BROKERS: 'localhost:9092', KAFKA_TOPIC: 'test.events' },
      metrics,
    );

    await mocks.eachMessage({
      topic: 'test.events',
      partition: 1,
      message: {
        key: Buffer.from('project-id'),
        offset: '12',
        value: Buffer.from(
          JSON.stringify({
            event_id: 'event-id',
            event_type: 'task.assignments.changed',
            project_id: '00000000-0000-0000-0000-000000000001',
            diagram_id: '00000000-0000-0000-0000-000000000002',
            entity_id: '00000000-0000-0000-0000-000000000003',
            payload: {
              assignments: [
                {
                  assigneeType: 'user',
                  assigneeId: '00000000-0000-0000-0000-000000000004',
                  role: 'executor',
                },
                {
                  assigneeType: 'user',
                  assigneeId: '00000000-0000-0000-0000-000000000005',
                  role: 'co_executor',
                },
                {
                  assigneeType: 'user',
                  assigneeId: '00000000-0000-0000-0000-000000000006',
                  role: 'responsible',
                },
                {
                  assigneeType: 'executor',
                  assigneeId: '00000000-0000-0000-0000-000000000007',
                  role: 'executor',
                },
              ],
            },
          }),
        ),
      },
    });

    expect(mocks.consumer.subscribe).toHaveBeenNthCalledWith(1, { topic: 'test.events' });
    expect(mocks.consumer.subscribe).toHaveBeenNthCalledWith(2, {
      topic: 'test.events.replay.notification',
      fromBeginning: true,
    });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('SELECT 1 FROM events.processed_events'),
      expect.stringContaining('INSERT INTO notify.notifications'),
      expect.stringContaining('INSERT INTO notify.notifications'),
      expect.stringContaining(
        "INSERT INTO events.processed_events (consumer, event_id) VALUES ('notification', $1)",
      ),
      'COMMIT',
    ]);
    expect(
      client.query.mock.calls
        .filter(([sql]) => sql.includes('INSERT INTO notify.notifications'))
        .map(([, params]) => params[0]),
    ).toEqual(['00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005']);
    expect(client.release).toHaveBeenCalledOnce();
    expect(mocks.producer.send).not.toHaveBeenCalled();
    expect(await metrics.registry.metrics()).toContain(
      'events_processed_total{service="notification"} 1',
    );

    await stop();
    expect(mocks.consumer.disconnect).toHaveBeenCalledOnce();
    expect(mocks.producer.disconnect).toHaveBeenCalledOnce();
  });
});
