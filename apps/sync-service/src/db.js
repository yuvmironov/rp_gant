import pg from 'pg';

const { Pool } = pg;

export function createPool(env = process.env) {
  const connectionString = env.DATABASE_URL_SYNC || env.DATABASE_URL;
  const config = connectionString
    ? { connectionString }
    : {
        host: env.PGHOST ?? 'localhost',
        port: Number(env.PGPORT ?? 5432),
        user: env.PGUSER,
        password: env.PGPASSWORD,
        database: env.PGDATABASE ?? 'rp_gant_sync',
      };
  if (!connectionString && (!config.user || !config.password)) {
    throw new Error('database_url_required');
  }
  return new Pool({ ...config, max: 10, idleTimeoutMillis: 30_000 });
}

export async function closePool(pool) {
  await pool.end();
}
