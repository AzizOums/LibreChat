import { Pool } from 'pg';
import type { KbDbConfig } from './config';
import { getKbConfig } from './config';

let pool: Pool | null = null;

export function getKbPool(config?: KbDbConfig): Pool {
  if (pool) {
    return pool;
  }
  const db = config ?? getKbConfig().db;
  pool = new Pool({
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    max: 10,
  });
  return pool;
}

export async function closeKbPool(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.end();
  pool = null;
}
