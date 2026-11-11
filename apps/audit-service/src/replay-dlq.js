import { readFileSync } from 'node:fs';
import { getKafkaConnectionOptions, getKafkaTopic } from '@rp-gant/service-kit';
import { Kafka, logLevel } from 'kafkajs';
import { createDlqReplayPlan } from './dlq-replay-plan.js';

function parseArgs(args) {
  const options = { apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--help') {
      options.help = true;
      continue;
    }
    if (!['--service', '--file', '--confirm', '--brokers'].includes(arg)) {
      throw new Error(`unknown_option:${arg}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`value_required:${arg}`);
    options[arg.slice(2)] = value;
    index += 1;
  }
  if (options.apply && !options.confirm) throw new Error('apply_requires_confirm');
  if (!options.apply && options.confirm) throw new Error('confirm_requires_apply');
  if (!options.help && (!options.service || !options.file)) {
    throw new Error('service_and_file_required');
  }
  return options;
}

function printHelp() {
  console.log(
    [
      'DLQ replay (dry-run unless --apply is provided)',
      '  pnpm dlq:replay -- --service audit|notification|sync --file <dlq-value.json>',
      '  pnpm dlq:replay -- --service audit|notification|sync --file <dlq-value.json> --apply --confirm <event_id>',
      '  Optional: --brokers localhost:9092,localhost:9093',
    ].join('\n'),
  );
}

function summary(plan) {
  return {
    service: plan.service,
    event_id: plan.eventId,
    event_type: plan.eventType,
    attempts: plan.attempts,
    failed_at: plan.failedAt,
    source: plan.source,
    dlq_topic: plan.dlqTopic,
    replay_topic: plan.replayTopic,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const record = JSON.parse(readFileSync(options.file, 'utf8'));
  const baseTopic = getKafkaTopic(process.env);
  const plan = createDlqReplayPlan({ record, service: options.service, baseTopic });
  if (options.apply && options.confirm !== plan.eventId) {
    throw new Error('confirmation_event_id_mismatch');
  }

  if (!options.apply) {
    console.log(JSON.stringify({ ...summary(plan), mode: 'dry-run' }, null, 2));
    return;
  }

  const kafka = new Kafka({
    clientId: 'rp-gant-dlq-replay',
    ...getKafkaConnectionOptions({
      ...process.env,
      KAFKA_BROKERS: options.brokers ?? process.env.KAFKA_BROKERS ?? 'localhost:9092',
    }),
    logLevel: logLevel.NOTHING,
  });
  const producer = kafka.producer();
  try {
    await producer.connect();
    const result = await producer.send({
      topic: plan.replayTopic,
      messages: [
        {
          key: plan.source.key ?? plan.eventId,
          value: JSON.stringify(plan.envelope),
          headers: {
            'x-rpgant-replay-from': `${plan.dlqTopic}:${plan.source.partition}:${plan.source.offset}`,
          },
        },
      ],
    });
    console.log(
      JSON.stringify(
        {
          ...summary(plan),
          applied: true,
          published: result.map(({ partition, baseOffset }) => ({ partition, baseOffset })),
        },
        null,
        2,
      ),
    );
  } finally {
    await producer.disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`DLQ replay failed: ${error.message}`);
  process.exitCode = 1;
});
