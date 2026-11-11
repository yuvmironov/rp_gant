import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'rp_gant_' });

  const requests = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const outboxPending = new Gauge({
    name: 'outbox_pending',
    help: 'Number of events waiting to be published from the outbox',
    labelNames: ['service'],
    registers: [registry],
  });
  const outboxRetries = new Gauge({
    name: 'outbox_events_retry_count_gt_3',
    help: 'Number of unpublished outbox events with more than three retries',
    labelNames: ['service'],
    registers: [registry],
  });
  const outboxPublishErrors = new Counter({
    name: 'outbox_publish_errors_total',
    help: 'Total failed outbox publish cycles',
    labelNames: ['service'],
    registers: [registry],
  });
  const eventsProcessed = new Counter({
    name: 'events_processed_total',
    help: 'Total successfully processed events',
    labelNames: ['service'],
    registers: [registry],
  });
  const eventsFailed = new Counter({
    name: 'events_failed_total',
    help: 'Total failed event processing attempts',
    labelNames: ['service'],
    registers: [registry],
  });
  const dlqMessages = new Counter({
    name: 'dlq_messages_total',
    help: 'Total messages sent to a dead-letter topic',
    labelNames: ['service'],
    registers: [registry],
  });
  const eventProcessingDuration = new Histogram({
    name: 'event_processing_duration_seconds',
    help: 'Time spent processing an event including retries',
    labelNames: ['service'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10, 20, 30],
    registers: [registry],
  });
  const eventProcessingLag = new Histogram({
    name: 'event_processing_lag_seconds',
    help: 'Age of an event at the end of consumer processing, based on occurred_at',
    labelNames: ['service'],
    buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600],
    registers: [registry],
  });

  return {
    registry,
    requests,
    duration,
    outboxPending,
    outboxRetries,
    outboxPublishErrors,
    eventsProcessed,
    eventsFailed,
    dlqMessages,
    eventProcessingDuration,
    eventProcessingLag,
  };
}

export function registerMetrics(app, metrics) {
  app.get('/metrics', async (_request, reply) => {
    reply.type(metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  app.addHook('onResponse', async (request, reply) => {
    if (request.routeOptions?.url === '/metrics') return;
    const labels = {
      method: request.method,
      route: request.routeOptions?.url ?? 'unmatched',
      status: String(reply.statusCode),
    };
    metrics.requests.inc(labels);
    metrics.duration.observe(labels, reply.elapsedTime / 1000);
  });
}
