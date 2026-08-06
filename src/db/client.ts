import { drizzle } from 'drizzle-orm/node-postgres';
import { drizzle as sqliteDrizzle } from 'drizzle-orm/better-sqlite3';
import pg from 'pg';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as schema from './schema/index.js';

const { Pool } = pg;

function createPostgresClient() {
  logger.info('Initializing production PostgreSQL client...');
  // We expect PG environment variables (PGHOST, PGPORT, etc.) to be configured,
  // or a custom connection string in COMM_BASE_URL/DATABASE_URL.
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({
    connectionString,
  });

  return drizzle(pool, { schema });
}

function createSQLiteClient() {
  logger.info('Initializing development SQLite client...');
  const sqliteFile = process.env.SQLITE_DB_PATH || 'local_dev.db';
  const sqliteDb = new Database(sqliteFile);

  // Enable foreign keys
  sqliteDb.pragma('foreign_keys = ON');

  return sqliteDrizzle(sqliteDb, { schema });
}

export const db =
  env.NODE_ENV === 'production' || process.env.DATABASE_URL
    ? createPostgresClient()
    : (createSQLiteClient() as any); // Cast for dual dialect usage
export type DatabaseInstance = typeof db;
export { schema };
export default db;
