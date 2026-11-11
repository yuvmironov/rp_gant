import { describe, expect, it, vi } from 'vitest';
import { runWithDlq } from '../src/consumer-dlq.js';
import { createMetrics } from '../src/metrics.js';

const context = {
  topic: 'rp_gant.events',
  partition: 2,
  message: {
    key: Buffer.from('project-42'),
    value: Buffer.from('{"event_id":"event-42","event_type":"task.updated"}'),
    offset: '105',
  },
};

describe('runWithDlq', () => {
  it('retries using the configured delay and returns on success', async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce();
    const wait = vi.fn().mockResolvedValue(undefined);
    const producer = { send: vi.fn() };

    const result = await runWithDlq({
      context,
      handler,
      producer,
      dlqTopic: 'rp_gant.events.dlq.audit',
      retryDelaysMs: [25],
      wait,
    });

    expect(result).toEqual({ attempts: 2, deadLettered: false });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(25);
    expect(producer.send).not.toHaveBeenCalled();
  });

  it('sends the envelope and bounded error metadata to DLQ after exhausting attempts', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const wait = vi.fn().mockResolvedValue(undefined);
    const producer = { send: vi.fn().mockResolvedValue(undefined) };
    const metrics = createMetrics();
    const timestamp = new Date('2026-11-11T12:00:00.000Z');

    const result = await runWithDlq({
      context,
      handler,
      producer,
      dlqTopic: 'rp_gant.events.dlq.audit',
      retryDelaysMs: [10, 20],
      wait,
      now: () => timestamp,
      metrics,
      service: 'audit',
    });

    expect(result).toEqual({ attempts: 3, deadLettered: true });
    expect(handler).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[10], [20]]);
    const metricOutput = await metrics.registry.metrics();
    expect(metricOutput).toContain('events_failed_total{service="audit"} 3');
    expect(metricOutput).toContain('dlq_messages_total{service="audit"} 1');
    expect(metricOutput).not.toContain('events_processed_total{service="audit"}');
    expect(producer.send).toHaveBeenCalledWith({
      topic: 'rp_gant.events.dlq.audit',
      messages: [
        {
          key: 'event-42',
          value: JSON.stringify({
            consumer: 'audit',
            dlq_topic: 'rp_gant.events.dlq.audit',
            envelope: { event_id: 'event-42', event_type: 'task.updated' },
            error: { name: 'Error', message: 'database unavailable' },
            attempts: 3,
            failed_at: '2026-11-11T12:00:00.000Z',
            source: {
              topic: 'rp_gant.events',
              partition: 2,
              offset: '105',
              key: 'project-42',
            },
          }),
        },
      ],
    });
  });

  it('records observed event age from the envelope occurrence timestamp', async () => {
    const metrics = createMetrics();
    const producer = { send: vi.fn() };
    const occurredAt = new Date(Date.now() - 400_000).toISOString();
    const eventContext = {
      ...context,
      message: {
        ...context.message,
        value: Buffer.from(JSON.stringify({ event_id: 'event-42', occurred_at: occurredAt })),
      },
    };

    await runWithDlq({
      context: eventContext,
      handler: vi.fn().mockResolvedValue(undefined),
      producer,
      dlqTopic: 'rp_gant.events.dlq.audit',
      metrics,
      service: 'audit',
    });

    const metricOutput = await metrics.registry.metrics();
    expect(metricOutput).toContain('event_processing_lag_seconds_count{service="audit"} 1');
    const lagSum = Number(
      metricOutput.match(/event_processing_lag_seconds_sum\{service="audit"\} ([\d.]+)/)?.[1],
    );
    expect(lagSum).toBeGreaterThanOrEqual(399);
  });

  it('preserves an invalid JSON message and leaves the offset retryable if DLQ publish fails', async () => {
    const producer = { send: vi.fn().mockRejectedValue(new Error('DLQ unavailable')) };
    const message = { ...context.message, value: Buffer.from('not-json') };

    await expect(
      runWithDlq({
        context: { ...context, message },
        handler: vi.fn().mockRejectedValue(new Error('poison message')),
        producer,
        dlqTopic: 'rp_gant.events.dlq.audit',
        service: 'audit',
        retryDelaysMs: [],
      }),
    ).rejects.toThrow('DLQ unavailable');

    const payload = JSON.parse(producer.send.mock.calls[0][0].messages[0].value);
    expect(payload.envelope).toEqual({ raw: 'not-json' });
  });
});
