import { z } from 'zod';

/**
 * Knowledge Base (KB) shared types.
 *
 * KB documents are admin-managed files ingested into pgvector for
 * access-controlled RAG. Metadata and access rights live in MongoDB;
 * chunk embeddings live in PostgreSQL (`kb_chunks`).
 */

export enum KbIngestionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export enum KbIngestionStage {
  UPLOADED = 'uploaded',
  EXTRACTING = 'extracting',
  CHUNKING = 'chunking',
  EMBEDDING = 'embedding',
  STORING = 'storing',
  DONE = 'done',
}

export const kbChunkingParamsSchema = z.object({
  chunkSize: z.number().int().positive(),
  chunkOverlap: z.number().int().nonnegative(),
});

export const kbEmbeddingsInfoSchema = z.object({
  provider: z.string(),
  model: z.string(),
  dimensions: z.number().int().positive(),
});

export const kbIngestionProgressSchema = z.object({
  stage: z.nativeEnum(KbIngestionStage),
  processedChunks: z.number().int().nonnegative().optional(),
  totalChunks: z.number().int().nonnegative().optional(),
});

export const kbDocumentSchema = z.object({
  _id: z.string(),
  file_id: z.string(),
  filename: z.string(),
  type: z.string(),
  bytes: z.number(),
  status: z.nativeEnum(KbIngestionStatus),
  progress: kbIngestionProgressSchema.optional(),
  error: z.string().optional(),
  chunkCount: z.number().int().nonnegative().optional(),
  chunking: kbChunkingParamsSchema.optional(),
  embeddings: kbEmbeddingsInfoSchema.optional(),
  filepath: z.string().optional(),
  source: z.string().optional(),
  uploadedBy: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type TKbChunkingParams = z.infer<typeof kbChunkingParamsSchema>;
export type TKbEmbeddingsInfo = z.infer<typeof kbEmbeddingsInfoSchema>;
export type TKbIngestionProgress = z.infer<typeof kbIngestionProgressSchema>;
export type TKbDocument = z.infer<typeof kbDocumentSchema>;

export type TKbChunkMetadata = {
  page?: number;
  source?: string;
};

export type TKbDocumentsQuery = {
  status?: KbIngestionStatus;
  cursor?: string;
  limit?: number;
};

export type TKbDocumentsResponse = {
  documents: TKbDocument[];
  nextCursor?: string;
};

export type TKbDocumentResponse = {
  document: TKbDocument;
};

export type TKbAccessPrincipal = {
  principalId: string;
  name?: string;
  email?: string;
  avatar?: string;
  deny: boolean;
  grantedAt?: string;
};

export type TKbDocumentAccessResponse = {
  file_id: string;
  groups: TKbAccessPrincipal[];
  users: TKbAccessPrincipal[];
};

export type TKbSearchResult = {
  file_id: string;
  filename: string;
  chunkIndex: number;
  content: string;
  distance: number;
  metadata?: TKbChunkMetadata;
};
