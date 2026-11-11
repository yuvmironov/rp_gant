import { readFileSync } from 'node:fs';

const saslMechanisms = new Set(['plain', 'scram-sha-256', 'scram-sha-512']);

export function getKafkaConnectionOptions(env = process.env) {
  const brokers = String(env.KAFKA_BROKERS ?? 'kafka:9092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
  if (brokers.length === 0) throw new Error('kafka_brokers_required');

  const sslValue = env.KAFKA_SSL?.trim().toLowerCase();
  if (sslValue && !['true', 'false'].includes(sslValue)) {
    throw new Error('invalid_kafka_ssl');
  }
  const sslEnabled = sslValue === 'true';
  const saslMechanism = env.KAFKA_SASL_MECHANISM?.trim().toLowerCase();
  const saslUsername = env.KAFKA_SASL_USERNAME;
  const saslPassword = env.KAFKA_SASL_PASSWORD;
  const saslConfigured = Boolean(saslMechanism || saslUsername || saslPassword);
  const caFile = env.KAFKA_SSL_CA_FILE?.trim();
  const caValue = env.KAFKA_SSL_CA;

  if (saslConfigured && !sslEnabled) throw new Error('kafka_sasl_requires_ssl');
  if ((caFile || caValue) && !sslEnabled) throw new Error('kafka_ssl_ca_requires_ssl');
  if (caFile && caValue) throw new Error('multiple_kafka_ssl_ca_sources');
  if (saslConfigured) {
    if (!saslMechanism || !saslUsername || !saslPassword) {
      throw new Error('kafka_sasl_credentials_required');
    }
    if (!saslMechanisms.has(saslMechanism)) throw new Error('unsupported_kafka_sasl_mechanism');
  }

  const sslCa = caFile ? readFileSync(caFile) : caValue;
  return {
    brokers,
    ...(sslEnabled && {
      ssl: sslCa ? { ca: sslCa, rejectUnauthorized: true } : true,
    }),
    ...(saslConfigured && {
      sasl: { mechanism: saslMechanism, username: saslUsername, password: saslPassword },
    }),
  };
}
