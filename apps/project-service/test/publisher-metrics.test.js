import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMetrics } from '@rp-gant/service-kit';

const mocks = vi.hoisted(() => ({
  producer: {
    connect: vi.fn(),
    send: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('kafkajs', () => ({
  Kafka: class {
    producer() {
      return mocks.producer;
    }
  },
  logLevel: { NOTHING: 0 },
}));

import { startOutboxPublisher } from '../src/events/publisher.js';

describe('project outbox publisher metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.producer.connect.mockResolvedValue(undefined);
    mocks.producer.send.mockResolvedValue(undefined);
    mocks.producer.disconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the current pending outbox count', async () => {
    const metrics = createMetrics();
    const db = {
      async query(sql) {
        if (sql.includes('count(*)')) {
          return { rows: [{ pending: '8', retry_exceeded: '2' }] };
        }
        return { rows: [] };
      },
    };
    const stop = startOutboxPublisher(db, { KAFKA_BROKERS: 'localhost:9092' }, metrics);

    try {
      await vi.waitFor(async () => {
        const output = await metrics.registry.metrics();
        expect(output).toContain('outbox_pending{service="project"} 8');
        expect(output).toContain('outbox_events_retry_count_gt_3{service="project"} 2');
      });
    } finally {
      await stop();
    }
  });

  it('counts failed publish cycles', async () => {
    const metrics = createMetrics();
    const db = {
      async query(sql) {
        if (sql.includes('count(*)')) {
          return { rows: [{ pending: '3', retry_exceeded: '1' }] };
        }
        return { rows: [] };
      },
    };
    mocks.producer.connect.mockRejectedValueOnce(new Error('broker unavailable'));
    const stop = startOutboxPublisher(db, { KAFKA_BROKERS: 'localhost:9092' }, metrics);

    try {
      await vi.waitFor(async () => {
        expect(await metrics.registry.metrics()).toContain(
          'outbox_publish_errors_total{service="project"} 1',
        );
      });
    } finally {
      await stop();
    }
  });
});
