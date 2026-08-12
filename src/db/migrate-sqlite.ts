import Database from 'better-sqlite3';
import { logger } from '../config/logger.js';

export function runSqliteMigrations() {
  logger.info('Initializing SQLite database schema...');
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

    CREATE TABLE IF NOT EXISTS "link_sessions" (
      "id" TEXT PRIMARY KEY,
      "actor_id" TEXT,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "expires_at" TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "knowledge_sources" (
      "id" TEXT PRIMARY KEY,
      "repository_id" TEXT,
      "type" TEXT NOT NULL,
      "path_or_url" TEXT NOT NULL,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "documents" (
      "id" TEXT PRIMARY KEY,
      "knowledge_source_id" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "checksum" TEXT NOT NULL,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "document_chunks" (
      "id" TEXT PRIMARY KEY,
      "document_id" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "sequence_order" INTEGER NOT NULL,
      "chunk_index" INTEGER NOT NULL,
      "token_count" INTEGER NOT NULL,
      "checksum" TEXT NOT NULL,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "doc_chunks_unique_idx" ON "document_chunks" ("document_id", "chunk_index");

    CREATE TABLE IF NOT EXISTS "embeddings" (
      "id" TEXT PRIMARY KEY,
      "memory_chunk_id" TEXT,
      "document_chunk_id" TEXT,
      "vector" TEXT NOT NULL,
      "chunk_hash" TEXT NOT NULL,
      "embedding_model" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "dimension" INTEGER NOT NULL,
      "token_count" INTEGER NOT NULL,
      "checksum" TEXT NOT NULL,
      "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `;

  db.exec(ddl);
  logger.info('SQLite schema initialized successfully.');
  db.close();
}
