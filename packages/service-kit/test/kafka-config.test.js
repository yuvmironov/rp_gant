import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getKafkaConnectionOptions } from '../src/kafka-config.js';

describe('getKafkaConnectionOptions', () => {
  it('defaults to local plain-text Kafka without SASL', () => {
    expect(getKafkaConnectionOptions({})).toEqual({ brokers: ['kafka:9092'] });
  });

  it('trims broker lists and omits empty entries', () => {
    expect(getKafkaConnectionOptions({ KAFKA_BROKERS: ' kafka-a:9092, ,kafka-b:9092 ' })).toEqual({
      brokers: ['kafka-a:9092', 'kafka-b:9092'],
    });
  });

  it('enables verified TLS with a provided CA certificate', () => {
    expect(getKafkaConnectionOptions({ KAFKA_SSL: 'true', KAFKA_SSL_CA: 'test-ca-pem' })).toEqual({
      brokers: ['kafka:9092'],
      ssl: { ca: 'test-ca-pem', rejectUnauthorized: true },
    });
  });

  it('loads an optional TLS CA from a mounted file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rp-gant-kafka-ca-'));
    const caFile = join(directory, 'ca.pem');
    try {
      writeFileSync(caFile, 'mounted-ca');
      expect(getKafkaConnectionOptions({ KAFKA_SSL: 'true', KAFKA_SSL_CA_FILE: caFile })).toEqual({
        brokers: ['kafka:9092'],
        ssl: { ca: Buffer.from('mounted-ca'), rejectUnauthorized: true },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('supports SASL SCRAM over TLS', () => {
    expect(
      getKafkaConnectionOptions({
        KAFKA_SSL: 'true',
        KAFKA_SASL_MECHANISM: 'SCRAM-SHA-512',
        KAFKA_SASL_USERNAME: 'staging-user',
        KAFKA_SASL_PASSWORD: 'staging-password',
      }),
    ).toEqual({
      brokers: ['kafka:9092'],
      ssl: true,
      sasl: {
        mechanism: 'scram-sha-512',
        username: 'staging-user',
        password: 'staging-password',
      },
    });
  });

  it('requires TLS when SASL credentials are configured', () => {
    expect(() =>
      getKafkaConnectionOptions({
        KAFKA_SASL_MECHANISM: 'plain',
        KAFKA_SASL_USERNAME: 'user',
        KAFKA_SASL_PASSWORD: 'password',
      }),
    ).toThrow('kafka_sasl_requires_ssl');
  });

  it('rejects incomplete SASL configuration without echoing credentials', () => {
    expect(() =>
      getKafkaConnectionOptions({
        KAFKA_SSL: 'true',
        KAFKA_SASL_MECHANISM: 'plain',
        KAFKA_SASL_USERNAME: 'user',
      }),
    ).toThrow('kafka_sasl_credentials_required');
  });

  it('rejects unsupported SASL mechanisms', () => {
    expect(() =>
      getKafkaConnectionOptions({
        KAFKA_SSL: 'true',
        KAFKA_SASL_MECHANISM: 'unsupported',
        KAFKA_SASL_USERNAME: 'user',
        KAFKA_SASL_PASSWORD: 'password',
      }),
    ).toThrow('unsupported_kafka_sasl_mechanism');
  });

  it('rejects invalid TLS flags and CA configuration without TLS', () => {
    expect(() => getKafkaConnectionOptions({ KAFKA_SSL: 'yes' })).toThrow('invalid_kafka_ssl');
    expect(() => getKafkaConnectionOptions({ KAFKA_SSL_CA: 'test-ca-pem' })).toThrow(
      'kafka_ssl_ca_requires_ssl',
    );
  });

  it('rejects empty broker lists and multiple CA sources', () => {
    expect(() => getKafkaConnectionOptions({ KAFKA_BROKERS: ' , ' })).toThrow(
      'kafka_brokers_required',
    );
    expect(() =>
      getKafkaConnectionOptions({
        KAFKA_SSL: 'true',
        KAFKA_SSL_CA: 'pem',
        KAFKA_SSL_CA_FILE: 'ca.pem',
      }),
    ).toThrow('multiple_kafka_ssl_ca_sources');
  });
});
