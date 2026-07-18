import { logger } from '@librechat/data-schemas';
import { KbIngestionStage, KbIngestionStatus } from 'librechat-data-provider';
import type { IKbDocument, KbDocumentMethods } from '@librechat/data-schemas';
import type { KbChunkInsert } from './chunks';
import { insertKbChunks, deleteKbChunks } from './chunks';
import { extractKbText } from './extract';
import { splitText } from './splitter';
import { embedTexts } from './embeddings';
import { getKbConfig } from './config';

export type KbWorkerDeps = Pick<
  KbDocumentMethods,
  'claimNextPendingKbDocument' | 'updateKbIngestion' | 'resetStalledKbDocuments'
>;

export interface KbWorker {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const MAX_ERROR_LENGTH = 500;

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

async function ingestKbDocument(document: IKbDocument, deps: KbWorkerDeps): Promise<void> {
  const config = getKbConfig();
  const fileId = document.file_id;
  const chunking = document.chunking ?? config.chunking;

  if (!document.filepath) {
    throw new Error('Document has no stored source file');
  }

  const text = await extractKbText({
    filepath: document.filepath,
    filename: document.filename,
    mimetype: document.type,
    bytes: document.bytes,
  });

  await deps.updateKbIngestion(fileId, {
    progress: { stage: KbIngestionStage.CHUNKING },
  });
  const chunks = splitText(text, chunking);
  if (chunks.length === 0) {
    throw new Error('No text content found in document');
  }

  await deleteKbChunks(fileId);
  await deps.updateKbIngestion(fileId, {
    progress: { stage: KbIngestionStage.EMBEDDING, processedChunks: 0, totalChunks: chunks.length },
  });

  const batchSize = config.worker.embeddingBatchSize;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const embeddings = await embedTexts(batch, config.embeddings);
    const rows: KbChunkInsert[] = batch.map((content, j) => ({
      chunkIndex: i + j,
      content,
      embedding: embeddings[j],
      metadata: { source: document.filename },
    }));
    await insertKbChunks(fileId, rows);
    await deps.updateKbIngestion(fileId, {
      progress: {
        stage: KbIngestionStage.STORING,
        processedChunks: Math.min(i + batch.length, chunks.length),
        totalChunks: chunks.length,
      },
    });
  }

  await deps.updateKbIngestion(fileId, {
    status: KbIngestionStatus.COMPLETED,
    progress: {
      stage: KbIngestionStage.DONE,
      processedChunks: chunks.length,
      totalChunks: chunks.length,
    },
    chunkCount: chunks.length,
    embeddings: {
      provider: config.embeddings.provider,
      model: config.embeddings.model,
      dimensions: config.embeddings.dimensions,
    },
    error: null,
  });
  logger.info(`[kb] Ingested document ${fileId} (${chunks.length} chunks)`);
}

/**
 * In-process ingestion worker. Each concurrency slot loops: atomically claim
 * the oldest pending document, run the extract→chunk→embed→store pipeline
 * with per-batch progress persisted in Mongo, then look for the next one.
 * All state lives in Mongo, so a restart resumes cleanly: stalled
 * `processing` documents are requeued on start and chunk writes are
 * idempotent upserts.
 */
export function createKbWorker(deps: KbWorkerDeps): KbWorker {
  let running = false;
  let loops: Promise<void>[] = [];

  async function processNext(): Promise<boolean> {
    const document = await deps.claimNextPendingKbDocument();
    if (!document) {
      return false;
    }
    try {
      await ingestKbDocument(document, deps);
    } catch (error) {
      logger.error(`[kb] Ingestion failed for document ${document.file_id}:`, error);
      await deps.updateKbIngestion(document.file_id, {
        status: KbIngestionStatus.ERROR,
        error: toErrorMessage(error),
      });
    }
    return true;
  }

  async function loop(pollIntervalMs: number): Promise<void> {
    while (running) {
      let processed = false;
      try {
        processed = await processNext();
      } catch (error) {
        logger.error('[kb] Worker loop error:', error);
      }
      if (!processed && running) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  }

  async function start(): Promise<void> {
    if (running) {
      return;
    }
    running = true;
    const { concurrency, pollIntervalMs } = getKbConfig().worker;
    const requeued = await deps.resetStalledKbDocuments();
    if (requeued > 0) {
      logger.info(`[kb] Requeued ${requeued} stalled document(s) from a previous run`);
    }
    loops = Array.from({ length: Math.max(concurrency, 1) }, () => loop(pollIntervalMs));
    logger.info(`[kb] Ingestion worker started (concurrency: ${Math.max(concurrency, 1)})`);
  }

  async function stop(): Promise<void> {
    running = false;
    await Promise.all(loops);
    loops = [];
  }

  return { start, stop };
}
