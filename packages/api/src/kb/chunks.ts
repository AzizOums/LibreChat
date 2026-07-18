import type { TKbChunkMetadata } from 'librechat-data-provider';
import type { Pool } from 'pg';
import { getKbPool } from './pool';

export interface KbChunkInsert {
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata?: TKbChunkMetadata;
}

export interface KbChunkSearchRow {
  file_id: string;
  chunk_index: number;
  content: string;
  metadata: TKbChunkMetadata;
  distance: number;
}

export interface SearchKbChunksParams {
  embedding: number[];
  /** Allowed file_ids — the access filter applied inside the SQL WHERE clause */
  fileIds: string[];
  k?: number;
  pool?: Pool;
}

const INSERT_BATCH_SIZE = 100;

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function insertBatch(pool: Pool, fileId: string, batch: KbChunkInsert[]): Promise<void> {
  const values: Array<string | number> = [];
  const rows = batch.map((chunk, i) => {
    const offset = i * 5;
    values.push(
      fileId,
      chunk.chunkIndex,
      chunk.content,
      JSON.stringify(chunk.metadata ?? {}),
      toVectorLiteral(chunk.embedding),
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::jsonb, $${offset + 5}::vector)`;
  });

  await pool.query(
    `INSERT INTO kb_chunks (file_id, chunk_index, content, metadata, embedding)
     VALUES ${rows.join(', ')}
     ON CONFLICT (file_id, chunk_index) DO UPDATE
     SET content = EXCLUDED.content,
         metadata = EXCLUDED.metadata,
         embedding = EXCLUDED.embedding`,
    values,
  );
}

export async function insertKbChunks(
  fileId: string,
  chunks: KbChunkInsert[],
  pool?: Pool,
): Promise<void> {
  const kbPool = pool ?? getKbPool();
  for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
    await insertBatch(kbPool, fileId, chunks.slice(i, i + INSERT_BATCH_SIZE));
  }
}

export async function deleteKbChunks(fileId: string, pool?: Pool): Promise<number> {
  const kbPool = pool ?? getKbPool();
  const result = await kbPool.query('DELETE FROM kb_chunks WHERE file_id = $1', [fileId]);
  return result.rowCount ?? 0;
}

export async function countKbChunks(fileId: string, pool?: Pool): Promise<number> {
  const kbPool = pool ?? getKbPool();
  const { rows } = await kbPool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM kb_chunks WHERE file_id = $1',
    [fileId],
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}

/**
 * Cosine-similarity search restricted to the given `fileIds`. The access
 * filter lives in the SQL WHERE clause, so chunks from documents outside the
 * caller's resolved permissions can never be returned. An empty `fileIds`
 * list short-circuits without touching the database.
 */
export async function searchKbChunks(params: SearchKbChunksParams): Promise<KbChunkSearchRow[]> {
  const { embedding, fileIds, k = 10 } = params;
  if (fileIds.length === 0) {
    return [];
  }

  const kbPool = params.pool ?? getKbPool();
  const { rows } = await kbPool.query<KbChunkSearchRow>(
    `SELECT file_id, chunk_index, content, metadata,
            (embedding <=> $1::vector) AS distance
     FROM kb_chunks
     WHERE file_id = ANY($2::text[])
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [toVectorLiteral(embedding), fileIds, k],
  );
  return rows;
}
