import { describe, expect, it } from 'vitest';
import { createDlqReplayPlan } from '../src/dlq-replay-plan.js';

const record = {
  consumer: 'audit',
  dlq_topic: 'rp_gant.events.dlq.audit',
  envelope: { event_id: 'event-42', event_type: 'task.updated' },
  error: { name: 'Error', message: 'database unavailable' },
  attempts: 5,
  failed_at: '2026-11-11T12:00:00.000Z',
  source: { topic: 'rp_gant.events', partition: 2, offset: '105' },
};

describe('createDlqReplayPlan', () => {
  it('routes a confirmed audit record to the isolated audit replay topic', () => {
    expect(createDlqReplayPlan({ record, service: 'audit', baseTopic: 'rp_gant.events' })).toEqual({
      service: 'audit',
      eventId: 'event-42',
      eventType: 'task.updated',
      source: { topic: 'rp_gant.events', partition: 2, offset: '105', key: null },
      failedAt: '2026-11-11T12:00:00.000Z',
      attempts: 5,
      dlqTopic: 'rp_gant.events.dlq.audit',
      replayTopic: 'rp_gant.events.replay.audit',
      envelope: record.envelope,
    });
  });

  it('supports isolated replay topics for all durable consumer groups', () => {
    for (const service of ['notification', 'sync']) {
      const targetRecord = {
        ...record,
        consumer: service,
        dlq_topic: `rp_gant.events.dlq.${service}`,
      };
      expect(
        createDlqReplayPlan({
          record: targetRecord,
          service,
          baseTopic: 'rp_gant.events',
        }).replayTopic,
      ).toBe(`rp_gant.events.replay.${service}`);
    }
  });

  it('rejects records whose consumer does not match the requested replay target', () => {
    expect(() =>
      createDlqReplayPlan({ record, service: 'notification', baseTopic: 'rp_gant.events' }),
    ).toThrow('dlq_consumer_mismatch');
  });

  it('rejects a record from another DLQ topic', () => {
    expect(() =>
      createDlqReplayPlan({
        record: { ...record, dlq_topic: 'rp_gant.events.dlq.notification' },
        service: 'audit',
        baseTopic: 'rp_gant.events',
      }),
    ).toThrow('dlq_topic_mismatch');
  });
});
