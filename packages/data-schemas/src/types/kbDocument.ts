import type { Document, Types } from 'mongoose';
import { KbIngestionStatus, KbIngestionStage } from 'librechat-data-provider';

export type KbIngestionProgress = {
  stage: KbIngestionStage;
  processedChunks?: number;
  totalChunks?: number;
};

export type KbChunkingParams = {
  chunkSize: number;
  chunkOverlap: number;
};

export type KbEmbeddingsInfo = {
  provider: string;
  model: string;
  dimensions: number;
};

export type KbDocument = {
  /** UUID shared with the pgvector `kb_chunks.file_id` column */
  file_id: string;
  filename: string;
  /** MIME type */
  type: string;
  bytes: number;
  status: KbIngestionStatus;
  progress?: KbIngestionProgress;
  error?: string;
  chunkCount?: number;
  chunking?: KbChunkingParams;
  embeddings?: KbEmbeddingsInfo;
  /** Source file location, using the existing file storage strategies */
  filepath?: string;
  source?: string;
  uploadedBy?: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type IKbDocument = KbDocument &
  Document & {
    _id: Types.ObjectId;
  };
