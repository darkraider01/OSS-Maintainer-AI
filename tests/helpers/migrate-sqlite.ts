import Database from 'better-sqlite3';
import { logger } from '../../src/config/logger.js';

export function runSqliteMigrations() {
  logger.info('Initializing SQLite database schema for tests...');
  const db = new Database('local_dev.db');

  const ddl = `
    CREATE TABLE IF NOT EXISTS "actors" (
      "id" TEXT PRIMARY KEY,
      "type" TEXT NOT NULL,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "actor_accounts" (
      "id" TEXT PRIMARY KEY,
      "actor_id" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "provider_user_id" TEXT NOT NULL,
      "username" TEXT NOT NULL,
      "email" TEXT,
      "avatar_url" TEXT,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "repositories" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "url" TEXT NOT NULL,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "conversations" (
      "id" TEXT PRIMARY KEY,
      "repository_id" TEXT,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "conversation_channel_mappings" (
      "id" TEXT PRIMARY KEY,
      "conversation_id" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "channel_type" TEXT NOT NULL,
      "external_thread_id" TEXT NOT NULL,
      "metadata" TEXT,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "messages" (
      "id" TEXT PRIMARY KEY,
      "conversation_id" TEXT NOT NULL,
      "sender_actor_id" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `;

  db.exec(ddl);
  logger.info('SQLite schema initialized successfully.');
  db.close();
}

runSqliteMigrations();
