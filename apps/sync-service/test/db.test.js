import { afterEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db.js';

const pools = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

describe('Sync database pool', () => {
  it('uses Sync DB credentials when the local env file has no connection URL', () => {
    const pool = createPool({
      PGHOST: 'postgres',
      PGPORT: '5432',
      PGUSER: 'rp_gant',
      PGPASSWORD: 'local-password',
      PGDATABASE: 'rp_gant_sync',
    });
    pools.push(pool);

    expect(pool.options).toMatchObject({
      host: 'postgres',
      port: 5432,
      user: 'rp_gant',
      password: 'local-password',
      database: 'rp_gant_sync',
    });
  });

  it('rejects missing connection credentials', () => {
    expect(() => createPool({ PGHOST: 'postgres' })).toThrow('database_url_required');
  });
});
