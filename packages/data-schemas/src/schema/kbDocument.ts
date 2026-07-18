import { Schema } from 'mongoose';
import { KbIngestionStatus, KbIngestionStage } from 'librechat-data-provider';
import type { IKbDocument } from '~/types';

const kbDocumentSchema: Schema<IKbDocument> = new Schema<IKbDocument>(
  {
    file_id: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },
    filename: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    bytes: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(KbIngestionStatus),
      default: KbIngestionStatus.PENDING,
      index: true,
    },
    progress: {
      stage: {
        type: String,
        enum: Object.values(KbIngestionStage),
      },
      processedChunks: {
        type: Number,
      },
      totalChunks: {
        type: Number,
      },
    },
    error: {
      type: String,
    },
    chunkCount: {
      type: Number,
    },
    chunking: {
      chunkSize: {
        type: Number,
      },
      chunkOverlap: {
        type: Number,
      },
    },
    embeddings: {
      provider: {
        type: String,
      },
      model: {
        type: String,
      },
      dimensions: {
        type: Number,
      },
    },
    filepath: {
      type: String,
    },
    source: {
      type: String,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

kbDocumentSchema.index({ status: 1, createdAt: 1 });
kbDocumentSchema.index({ tenantId: 1, createdAt: -1 });

export default kbDocumentSchema;
