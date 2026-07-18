export interface KbDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface KbEmbeddingsConfig {
  provider: string;
  model: string;
  baseURL: string;
  apiKey?: string;
  dimensions: number;
}

export interface KbChunkingConfig {
  chunkSize: number;
  chunkOverlap: number;
}

export interface KbWorkerConfig {
  concurrency: number;
  pollIntervalMs: number;
  embeddingBatchSize: number;
}

export interface KbConfig {
  db: KbDbConfig;
  embeddings: KbEmbeddingsConfig;
  chunking: KbChunkingConfig;
  worker: KbWorkerConfig;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Knowledge Base configuration, read from environment variables. Database
 * values fall back to the `rag_api` service variables (DB_HOST, POSTGRES_*)
 * so the existing docker-compose pgvector instance works out of the box.
 * The embeddings provider defaults to Ollama; `KB_EMBEDDINGS_DIM` must match
 * the configured model (768 for `nomic-embed-text`).
 */
export function getKbConfig(): KbConfig {
  return {
    db: {
      host: process.env.KB_DB_HOST ?? process.env.DB_HOST ?? 'localhost',
      port: parseIntEnv(process.env.KB_DB_PORT ?? process.env.DB_PORT, 5432),
      database: process.env.KB_DB_NAME ?? process.env.POSTGRES_DB ?? 'mydatabase',
      user: process.env.KB_DB_USER ?? process.env.POSTGRES_USER ?? 'myuser',
      password: process.env.KB_DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'mypassword',
    },
    embeddings: {
      provider: process.env.KB_EMBEDDINGS_PROVIDER ?? 'ollama',
      model: process.env.KB_EMBEDDINGS_MODEL ?? 'nomic-embed-text',
      baseURL: process.env.KB_EMBEDDINGS_BASE_URL ?? 'http://localhost:11434',
      apiKey: process.env.KB_EMBEDDINGS_API_KEY,
      dimensions: parseIntEnv(process.env.KB_EMBEDDINGS_DIM, 768),
    },
    chunking: {
      chunkSize: parseIntEnv(process.env.KB_CHUNK_SIZE, 1000),
      chunkOverlap: parseIntEnv(process.env.KB_CHUNK_OVERLAP, 200),
    },
    worker: {
      concurrency: parseIntEnv(process.env.KB_WORKER_CONCURRENCY, 2),
      pollIntervalMs: parseIntEnv(process.env.KB_WORKER_POLL_MS, 5000),
      embeddingBatchSize: parseIntEnv(process.env.KB_EMBEDDINGS_BATCH, 32),
    },
  };
}
