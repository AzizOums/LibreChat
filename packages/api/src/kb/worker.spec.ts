import fs from 'fs';
import os from 'os';
import path from 'path';
import { Types } from 'mongoose';
import { KbIngestionStage, KbIngestionStatus } from 'librechat-data-provider';
import type { IKbDocument } from '@librechat/data-schemas';
import type { KbWorkerDeps } from './worker';
import { createKbWorker } from './worker';
import { embedTexts } from './embeddings';
import { insertKbChunks, deleteKbChunks } from './chunks';

jest.mock('./chunks', () => ({
  insertKbChunks: jest.fn().mockResolvedValue(undefined),
  deleteKbChunks: jest.fn().mockResolvedValue(0),
}));

jest.mock('./embeddings', () => ({
  embedTexts: jest.fn(),
}));

const mockedEmbed = embedTexts as jest.MockedFunction<typeof embedTexts>;
const mockedInsert = insertKbChunks as jest.MockedFunction<typeof insertKbChunks>;
const mockedDeleteChunks = deleteKbChunks as jest.MockedFunction<typeof deleteKbChunks>;

let tempDir: string;

beforeAll(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kb-worker-spec-'));
  process.env.KB_WORKER_POLL_MS = '10';
  process.env.KB_WORKER_CONCURRENCY = '1';
  process.env.KB_EMBEDDINGS_BATCH = '2';
  process.env.KB_EMBEDDINGS_DIM = '3';
});

afterAll(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
  delete process.env.KB_WORKER_POLL_MS;
  delete process.env.KB_WORKER_CONCURRENCY;
  delete process.env.KB_EMBEDDINGS_BATCH;
  delete process.env.KB_EMBEDDINGS_DIM;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedEmbed.mockImplementation((texts) => Promise.resolve(texts.map((_, i) => [i, i, i])));
});

async function createTextDocument(content: string): Promise<IKbDocument> {
  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const filepath = path.join(tempDir, `${fileId}.txt`);
  await fs.promises.writeFile(filepath, content);
  return {
    _id: new Types.ObjectId(),
    file_id: fileId,
    filename: 'doc.txt',
    type: 'text/plain',
    bytes: content.length,
    status: KbIngestionStatus.PROCESSING,
    chunking: { chunkSize: 200, chunkOverlap: 20 },
    filepath,
  } as IKbDocument;
}

function createDeps(documents: IKbDocument[]): KbWorkerDeps & { updates: unknown[][] } {
  const queue = [...documents];
  const updates: unknown[][] = [];
  return {
    updates,
    claimNextPendingKbDocument: jest.fn().mockImplementation(() => {
      return Promise.resolve(queue.shift() ?? null);
    }),
    updateKbIngestion: jest.fn().mockImplementation((fileId: string, update: unknown) => {
      updates.push([fileId, update]);
      return Promise.resolve(null);
    }),
    resetStalledKbDocuments: jest.fn().mockResolvedValue(0),
  };
}

async function runWorkerUntilIdle(deps: KbWorkerDeps): Promise<void> {
  const worker = createKbWorker(deps);
  await worker.start();
  const claim = deps.claimNextPendingKbDocument as jest.Mock;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const results = await Promise.all(
      claim.mock.results.map((r) => Promise.resolve(r.value).catch(() => null)),
    );
    if (results.length > 0 && results[results.length - 1] === null) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await worker.stop();
}

describe('createKbWorker', () => {
  it('requeues stalled documents on start', async () => {
    const deps = createDeps([]);
    (deps.resetStalledKbDocuments as jest.Mock).mockResolvedValue(3);
    const worker = createKbWorker(deps);
    await worker.start();
    await worker.stop();
    expect(deps.resetStalledKbDocuments).toHaveBeenCalledTimes(1);
  });

  it('ingests a claimed document end-to-end with staged progress', async () => {
    const document = await createTextDocument(
      Array.from({ length: 40 }, (_, i) => `Phrase d'exemple numéro ${i} pour le test.`).join(' '),
    );
    const deps = createDeps([document]);
    await runWorkerUntilIdle(deps);

    expect(mockedDeleteChunks).toHaveBeenCalledWith(document.file_id);
    expect(mockedInsert).toHaveBeenCalled();
    const firstInsert = mockedInsert.mock.calls[0];
    expect(firstInsert[0]).toBe(document.file_id);
    expect(firstInsert[1][0]).toEqual(
      expect.objectContaining({ chunkIndex: 0, embedding: [0, 0, 0] }),
    );

    const stages = deps.updates.map(
      ([, update]) => (update as { progress?: { stage?: string } }).progress?.stage,
    );
    expect(stages).toContain(KbIngestionStage.CHUNKING);
    expect(stages).toContain(KbIngestionStage.EMBEDDING);
    expect(stages).toContain(KbIngestionStage.STORING);

    const final = deps.updates[deps.updates.length - 1][1] as {
      status: string;
      chunkCount: number;
      embeddings: { provider: string };
      progress: { processedChunks: number; totalChunks: number };
    };
    expect(final.status).toBe(KbIngestionStatus.COMPLETED);
    expect(final.chunkCount).toBeGreaterThan(1);
    expect(final.progress.processedChunks).toBe(final.progress.totalChunks);
    expect(final.embeddings.provider).toBe('ollama');
  });

  it('marks the document as errored when embedding fails, then keeps running', async () => {
    const failing = await createTextDocument('Un document qui va échouer.');
    const succeeding = await createTextDocument('Un document qui va réussir.');
    mockedEmbed
      .mockRejectedValueOnce(new Error('embedding provider unreachable'))
      .mockImplementation((texts) => Promise.resolve(texts.map(() => [1, 1, 1])));

    const deps = createDeps([failing, succeeding]);
    await runWorkerUntilIdle(deps);

    const failingUpdates = deps.updates.filter(([fileId]) => fileId === failing.file_id);
    const lastFailing = failingUpdates[failingUpdates.length - 1][1] as {
      status: string;
      error: string;
    };
    expect(lastFailing.status).toBe(KbIngestionStatus.ERROR);
    expect(lastFailing.error).toContain('embedding provider unreachable');

    const succeedingUpdates = deps.updates.filter(([fileId]) => fileId === succeeding.file_id);
    const lastSucceeding = succeedingUpdates[succeedingUpdates.length - 1][1] as { status: string };
    expect(lastSucceeding.status).toBe(KbIngestionStatus.COMPLETED);
  });

  it('errors a document whose source file has no text', async () => {
    const document = await createTextDocument('   ');
    const deps = createDeps([document]);
    await runWorkerUntilIdle(deps);

    const last = deps.updates[deps.updates.length - 1][1] as { status: string; error: string };
    expect(last.status).toBe(KbIngestionStatus.ERROR);
    expect(last.error).toContain('No text content');
  });
});
