# Persistence Layer Specification

## Database Dialects

OSS-Maintainer-AI employs a dual-dialect architecture:

1.  **PostgreSQL (with `pgvector` extension)**: Production environment standard. It supports advanced indexing (HNSW/IVFFlat), range partitioning, and high-concurrency connections.
2.  **SQLite (`better-sqlite3`)**: Local development and testing environment fallback. SQLite avoids dependencies setup overhead for new open-source contributors.

---

## Data Schema Categories

### 1. Unified Event Conversations

Conversations are channel-agnostic threads (`conversations`). Integrations bind external platforms (Slack threads, GitLab issues) through `conversation_channel_mappings` without polluting core metadata columns.

### 2. Execution Tracing

Every workflow Template execution triggers an entry in the `executions` table. Running details, retry logs, warning indications, observations, and tool parameters are logged as discrete entries in `execution_events` and `tool_calls`.

### 3. Hierarchical Embeddings

To avoid token overhead and retain clean context boundaries:

- **Knowledge Sources**: Structured as `knowledge_sources` -> `documents` -> `document_chunks` -> `embeddings`.
- **Memories**: Structured as `memories` -> `memory_chunks` -> `embeddings`.

Embedding vectors are stored inside the `embeddings` table alongside model metadata (`embedding_model`, `provider`, `dimension`, `checksum`). This allows phased re-embedding when upgrading models.
