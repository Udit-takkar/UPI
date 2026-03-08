import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string, poolSize = 20) {
  const pool = new pg.Pool({
    connectionString,
    max: poolSize,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    application_name: 'upi-switch',
  });

  pool.on('error', (err) => {
    console.error('Unexpected pool error', err);
  });

  return drizzle(pool, { schema });
}

export { schema };
export * from './types.js';
