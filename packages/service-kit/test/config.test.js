import { describe, expect, it } from 'vitest';
import { getKafkaTopic, getSyncTokenSecret } from '../src/config.js';

describe('runtime configuration defaults', () => {
  it('uses the canonical Kafka topic when no topic is configured', () => {
    expect(getKafkaTopic({})).toBe('rp_gant.events');
    expect(getKafkaTopic({ KAFKA_TOPIC: '  ' })).toBe('rp_gant.events');
  });

  it('uses an explicitly configured Kafka topic', () => {
    expect(getKafkaTopic({ KAFKA_TOPIC: ' custom.events ' })).toBe('custom.events');
  });

  it('uses the development sync secret only in local environments', () => {
    expect(getSyncTokenSecret({ NODE_ENV: 'development' })).toBe('local-sync-secret');
    expect(getSyncTokenSecret({ NODE_ENV: 'test' })).toBe('local-sync-secret');
    expect(getSyncTokenSecret({ NODE_ENV: 'local' })).toBe('local-sync-secret');
    expect(getSyncTokenSecret({ NODE_ENV: 'production', RPGANT_ENV: 'local' })).toBe(
      'local-sync-secret',
    );
  });

  it('requires a configured secret outside local environments', () => {
    expect(() => getSyncTokenSecret({ NODE_ENV: 'production' })).toThrow(
      'sync_token_secret_required',
    );
    expect(() => getSyncTokenSecret({ NODE_ENV: 'staging', SYNC_TOKEN_SECRET: ' ' })).toThrow(
      'sync_token_secret_required',
    );
  });

  it('rejects known development placeholders outside local environments', () => {
    expect(() =>
      getSyncTokenSecret({ NODE_ENV: 'production', SYNC_TOKEN_SECRET: 'local-sync-secret' }),
    ).toThrow('sync_token_secret_not_configured');
    expect(() =>
      getSyncTokenSecret({ NODE_ENV: 'staging', SYNC_TOKEN_SECRET: 'CHANGE_ME_RANDOM_HEX' }),
    ).toThrow('sync_token_secret_not_configured');
  });

  it('accepts an explicitly configured deployment secret', () => {
    expect(
      getSyncTokenSecret({ NODE_ENV: 'production', SYNC_TOKEN_SECRET: 'deployment-secret' }),
    ).toBe('deployment-secret');
  });
});
