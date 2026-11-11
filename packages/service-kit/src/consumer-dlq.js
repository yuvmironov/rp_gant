const defaultRetryDelaysMs = [1000, 2000, 5000, 10000];

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function decodeEnvelope(value) {
  if (!value) return null;
  const raw = value.toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function toErrorMetadata(error) {
  return {
    name: String(error?.name ?? 'Error').slice(0, 100),
    message: String(error?.message ?? error).slice(0, 500),
  };
}

export async function runWithDlq({
  context,
  handler,
  producer,
  dlqTopic,
  retryDelaysMs = defaultRetryDelaysMs,
  wait = sleep,
  now = () => new Date(),
  metrics,
  service,
}) {
  let lastError;
  const maxAttempts = retryDelaysMs.length + 1;
  const startedAt = Date.now();
  const envelope = decodeEnvelope(context.message.value);

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await handler(context);
        if (metrics && service) metrics.eventsProcessed.inc({ service });
        return { attempts: attempt, deadLettered: false };
      } catch (error) {
        lastError = error;
        if (metrics && service) metrics.eventsFailed.inc({ service });
        if (attempt < maxAttempts) await wait(retryDelaysMs[attempt - 1]);
      }
    }

    const eventId = envelope && typeof envelope === 'object' ? envelope.event_id : undefined;
    await producer.send({
      topic: dlqTopic,
      messages: [
        {
          key: eventId ?? context.message.key ?? null,
          value: JSON.stringify({
            consumer: service,
            dlq_topic: dlqTopic,
            envelope,
            error: toErrorMetadata(lastError),
            attempts: maxAttempts,
            failed_at: now().toISOString(),
            source: {
              topic: context.topic,
              partition: context.partition,
              offset: String(context.message.offset),
              key: context.message.key?.toString('utf8') ?? null,
            },
          }),
        },
      ],
    });
    if (metrics && service) metrics.dlqMessages.inc({ service });

    return { attempts: maxAttempts, deadLettered: true };
  } finally {
    if (metrics && service) {
      metrics.eventProcessingDuration.observe({ service }, (Date.now() - startedAt) / 1000);
      const occurredAt = Date.parse(envelope?.occurred_at);
      if (Number.isFinite(occurredAt)) {
        metrics.eventProcessingLag.observe(
          { service },
          Math.max(0, (Date.now() - occurredAt) / 1000),
        );
      }
    }
  }
}
