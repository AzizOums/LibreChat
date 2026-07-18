import { logger } from '@librechat/data-schemas';
import type { Pool } from 'pg';
import type { KbEmbeddingsConfig } from './config';
import { getKbConfig } from './config';
import { getKbPool } from './pool';

interface KbSettingsRow {
  embedding_model: string;
  embedding_dim: number;
}

async function assertEmbeddingsCompatible(
  pool: Pool,
  embeddings: KbEmbeddingsConfig,
): Promise<void> {
  const { rows } = await pool.query<KbSettingsRow>(
    'SELECT embedding_model, embedding_dim FROM kb_settings WHERE id = 1',
  );

  if (rows.length === 0) {
    await pool.query(
      'INSERT INTO kb_settings (id, embedding_model, embedding_dim) VALUES (1, $1, $2)',
      [embeddings.model, embeddings.dimensions],
    );
    return;
  }

  const settings = rows[0];
  if (
    settings.embedding_model === embeddings.model &&
    settings.embedding_dim === embeddings.dimensions
  ) {
    return;
  }

  throw new Error(
    `KB embeddings configuration mismatch: the vector store was initialized with ` +
      `model "${settings.embedding_model}" (dim ${settings.embedding_dim}) but the current ` +
      `configuration is "${embeddings.model}" (dim ${embeddings.dimensions}). ` +
      `Existing embeddings are incompatible with a different model: either restore the ` +
      `original KB_EMBEDDINGS_* values, or drop the kb_chunks and kb_settings tables and ` +
      `re-ingest all documents.`,
  );
}

/**
 * Idempotent pgvector migration for the Knowledge Base: enables the `vector`
 * extension, creates the `kb_chunks` table sized to the configured embedding
 * dimension, and guards against embedding model/dimension drift via the
 * single-row `kb_settings` table. Safe to run on every server startup.
 */
export async function ensureKbSchema(pool?: Pool): Promise<void> {
  const config = getKbConfig();
  const kbPool = pool ?? getKbPool(config.db);
  const { dimensions } = config.embeddings;

  await kbPool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await kbPool.query(
    `CREATE TABLE IF NOT EXISTS kb_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      embedding_model text NOT NULL,
      embedding_dim integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  );
  await assertEmbeddingsCompatible(kbPool, config.embeddings);
  await kbPool.query(
    `CREATE TABLE IF NOT EXISTS kb_chunks (
      id bigserial PRIMARY KEY,
      file_id text NOT NULL,
      chunk_index integer NOT NULL,
      content text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      embedding vector(${dimensions}) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (file_id, chunk_index)
    )`,
  );
  await kbPool.query('CREATE INDEX IF NOT EXISTS idx_kb_chunks_file_id ON kb_chunks (file_id)');
  await kbPool.query(
    'CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON kb_chunks USING hnsw (embedding vector_cosine_ops)',
  );
  logger.info(`[kb] pgvector schema ready (model: ${config.embeddings.model}, dim: ${dimensions})`);
}
