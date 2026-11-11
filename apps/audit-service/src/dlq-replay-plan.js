const replayableConsumers = new Set(['audit', 'notification', 'sync']);

export function createDlqReplayPlan({ record, service, baseTopic }) {
  if (!replayableConsumers.has(service)) {
    throw new Error('replay_not_supported_for_consumer');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('invalid_dlq_record');
  }

  const envelope = record.envelope;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('dlq_envelope_required');
  }
  if (typeof envelope.event_id !== 'string' || !envelope.event_id.trim()) {
    throw new Error('dlq_event_id_required');
  }
  if (record.consumer !== service) {
    throw new Error('dlq_consumer_mismatch');
  }
  if (record.dlq_topic !== `${baseTopic}.dlq.${service}`) {
    throw new Error('dlq_topic_mismatch');
  }
  if (
    !record.source ||
    typeof record.source !== 'object' ||
    typeof record.source.topic !== 'string' ||
    !Number.isInteger(record.source.partition) ||
    !/^\d+$/.test(String(record.source.offset))
  ) {
    throw new Error('dlq_source_required');
  }

  return {
    service,
    eventId: envelope.event_id,
    eventType: envelope.event_type ?? null,
    source: {
      topic: record.source.topic,
      partition: record.source.partition,
      offset: String(record.source.offset),
      key: record.source.key ?? null,
    },
    failedAt: record.failed_at ?? null,
    attempts: Number(record.attempts ?? 0),
    dlqTopic: record.dlq_topic,
    replayTopic: `${baseTopic}.replay.${service}`,
    envelope,
  };
}
