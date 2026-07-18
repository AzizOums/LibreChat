import { getKbConfig } from './config';

const KB_ENV_KEYS = [
  'KB_DB_HOST',
  'KB_DB_PORT',
  'KB_DB_NAME',
  'KB_DB_USER',
  'KB_DB_PASSWORD',
  'DB_HOST',
  'DB_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'KB_EMBEDDINGS_PROVIDER',
  'KB_EMBEDDINGS_MODEL',
  'KB_EMBEDDINGS_BASE_URL',
  'KB_EMBEDDINGS_API_KEY',
  'KB_EMBEDDINGS_DIM',
  'KB_CHUNK_SIZE',
  'KB_CHUNK_OVERLAP',
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KB_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KB_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe('getKbConfig', () => {
  it('defaults to ollama embeddings with 768 dimensions', () => {
    const config = getKbConfig();
    expect(config.embeddings.provider).toBe('ollama');
    expect(config.embeddings.model).toBe('nomic-embed-text');
    expect(config.embeddings.baseURL).toBe('http://localhost:11434');
    expect(config.embeddings.apiKey).toBeUndefined();
    expect(config.embeddings.dimensions).toBe(768);
    expect(config.chunking).toEqual({ chunkSize: 1000, chunkOverlap: 200 });
  });

  it('falls back to the rag_api database variables', () => {
    process.env.DB_HOST = 'vectordb';
    process.env.DB_PORT = '5433';
    process.env.POSTGRES_DB = 'ragdb';
    process.env.POSTGRES_USER = 'raguser';
    process.env.POSTGRES_PASSWORD = 'ragpass';

    const { db } = getKbConfig();
    expect(db).toEqual({
      host: 'vectordb',
      port: 5433,
      database: 'ragdb',
      user: 'raguser',
      password: 'ragpass',
    });
  });

  it('prefers KB_-prefixed variables over rag_api fallbacks', () => {
    process.env.DB_HOST = 'vectordb';
    process.env.KB_DB_HOST = 'kb-postgres';
    process.env.POSTGRES_DB = 'ragdb';
    process.env.KB_DB_NAME = 'kbdb';

    const { db } = getKbConfig();
    expect(db.host).toBe('kb-postgres');
    expect(db.database).toBe('kbdb');
  });

  it('reads a custom embeddings provider configuration', () => {
    process.env.KB_EMBEDDINGS_PROVIDER = 'openai';
    process.env.KB_EMBEDDINGS_MODEL = 'text-embedding-3-small';
    process.env.KB_EMBEDDINGS_BASE_URL = 'https://api.openai.com/v1';
    process.env.KB_EMBEDDINGS_API_KEY = 'sk-test';
    process.env.KB_EMBEDDINGS_DIM = '1536';

    const { embeddings } = getKbConfig();
    expect(embeddings).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      dimensions: 1536,
    });
  });

  it('ignores non-numeric numeric values', () => {
    process.env.KB_EMBEDDINGS_DIM = 'not-a-number';
    process.env.KB_CHUNK_SIZE = '';

    const config = getKbConfig();
    expect(config.embeddings.dimensions).toBe(768);
    expect(config.chunking.chunkSize).toBe(1000);
  });
});
