import {
  ResourceType,
  PrincipalType,
  PrincipalModel,
  PermissionBits,
  KbIngestionStage,
  KbIngestionStatus,
} from 'librechat-data-provider';
import type { Model, Types, ClientSession, DeleteResult } from 'mongoose';
import type { KbIngestionProgress, KbEmbeddingsInfo, KbChunkingParams } from '~/types/kbDocument';
import type { IKbDocument, KbDocument } from '~/types/kbDocument';
import type { IAclEntry } from '~/types';

export interface KbAccessPrincipals {
  userId: string | Types.ObjectId;
  groupIds: Array<string | Types.ObjectId>;
}

export interface KbIngestionUpdate {
  status?: KbIngestionStatus;
  progress?: KbIngestionProgress;
  error?: string | null;
  chunkCount?: number;
  chunking?: KbChunkingParams;
  embeddings?: KbEmbeddingsInfo;
}

export interface ListKbDocumentsParams {
  status?: KbIngestionStatus;
  cursor?: string;
  limit?: number;
}

export interface ListKbDocumentsResult {
  documents: IKbDocument[];
  nextCursor?: string;
}

interface KbAclProjection {
  resourceId: Types.ObjectId;
  principalType: PrincipalType;
  permBits: number;
  deny?: boolean;
}

export function createKbDocumentMethods(mongoose: typeof import('mongoose')): {
  createKbDocument: (data: Partial<KbDocument>, session?: ClientSession) => Promise<IKbDocument>;
  findKbDocumentByFileId: (fileId: string) => Promise<IKbDocument | null>;
  findKbDocumentById: (id: string | Types.ObjectId) => Promise<IKbDocument | null>;
  listKbDocuments: (params?: ListKbDocumentsParams) => Promise<ListKbDocumentsResult>;
  updateKbIngestion: (fileId: string, update: KbIngestionUpdate) => Promise<IKbDocument | null>;
  claimNextPendingKbDocument: () => Promise<IKbDocument | null>;
  resetStalledKbDocuments: () => Promise<number>;
  deleteKbDocument: (fileId: string, session?: ClientSession) => Promise<DeleteResult>;
  grantKbGroupAccess: (
    resourceId: string | Types.ObjectId,
    groupId: string | Types.ObjectId,
    grantedBy?: string | Types.ObjectId,
  ) => Promise<IAclEntry | null>;
  revokeKbGroupAccess: (
    resourceId: string | Types.ObjectId,
    groupId: string | Types.ObjectId,
  ) => Promise<DeleteResult>;
  setKbUserOverride: (
    resourceId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    allow: boolean,
    grantedBy?: string | Types.ObjectId,
  ) => Promise<IAclEntry | null>;
  removeKbUserOverride: (
    resourceId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ) => Promise<DeleteResult>;
  findAccessibleKbResourceIds: (principals: KbAccessPrincipals) => Promise<Types.ObjectId[]>;
  findAccessibleKbFileIds: (principals: KbAccessPrincipals) => Promise<string[]>;
} {
  const { Types: MongooseTypes } = mongoose;

  function toObjectId(id: string | Types.ObjectId): Types.ObjectId {
    return typeof id === 'string' ? new MongooseTypes.ObjectId(id) : id;
  }

  function getKbDocumentModel(): Model<IKbDocument> {
    return mongoose.models.KbDocument as Model<IKbDocument>;
  }

  function getAclEntryModel(): Model<IAclEntry> {
    return mongoose.models.AclEntry as Model<IAclEntry>;
  }

  async function createKbDocument(
    data: Partial<KbDocument>,
    session?: ClientSession,
  ): Promise<IKbDocument> {
    const KbDocumentModel = getKbDocumentModel();
    const [document] = await KbDocumentModel.create([data], session ? { session } : {});
    return document;
  }

  async function findKbDocumentByFileId(fileId: string): Promise<IKbDocument | null> {
    return await getKbDocumentModel().findOne({ file_id: fileId }).lean<IKbDocument>();
  }

  async function findKbDocumentById(id: string | Types.ObjectId): Promise<IKbDocument | null> {
    return await getKbDocumentModel().findById(id).lean<IKbDocument>();
  }

  async function listKbDocuments(
    params: ListKbDocumentsParams = {},
  ): Promise<ListKbDocumentsResult> {
    const { status, cursor, limit = 25 } = params;
    const query: Record<string, unknown> = {};
    if (status) {
      query.status = status;
    }
    if (cursor) {
      query._id = { $lt: new MongooseTypes.ObjectId(cursor) };
    }

    const documents = await getKbDocumentModel()
      .find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean<IKbDocument[]>();

    if (documents.length <= limit) {
      return { documents };
    }

    const page = documents.slice(0, limit);
    return { documents: page, nextCursor: String(page[page.length - 1]._id) };
  }

  async function updateKbIngestion(
    fileId: string,
    update: KbIngestionUpdate,
  ): Promise<IKbDocument | null> {
    const set: Record<string, unknown> = {};
    const unset: Record<string, unknown> = {};

    if (update.status != null) {
      set.status = update.status;
    }
    if (update.progress != null) {
      set.progress = update.progress;
    }
    if (update.chunkCount != null) {
      set.chunkCount = update.chunkCount;
    }
    if (update.chunking != null) {
      set.chunking = update.chunking;
    }
    if (update.embeddings != null) {
      set.embeddings = update.embeddings;
    }
    if (update.error === null) {
      unset.error = 1;
    } else if (update.error != null) {
      set.error = update.error;
    }

    const operations: Record<string, unknown> = {};
    if (Object.keys(set).length > 0) {
      operations.$set = set;
    }
    if (Object.keys(unset).length > 0) {
      operations.$unset = unset;
    }

    return await getKbDocumentModel()
      .findOneAndUpdate({ file_id: fileId }, operations, { new: true })
      .lean<IKbDocument>();
  }

  /**
   * Atomically claims the oldest pending document for ingestion by flipping
   * its status to `processing`. Safe under concurrent workers and multiple
   * server instances: only one claimer wins each document.
   */
  async function claimNextPendingKbDocument(): Promise<IKbDocument | null> {
    return await getKbDocumentModel()
      .findOneAndUpdate(
        { status: KbIngestionStatus.PENDING },
        {
          $set: {
            status: KbIngestionStatus.PROCESSING,
            progress: { stage: KbIngestionStage.EXTRACTING },
          },
        },
        { sort: { _id: 1 }, new: true },
      )
      .lean<IKbDocument>();
  }

  /**
   * Requeues documents left in `processing` by a crashed or restarted server.
   * Chunk writes are idempotent upserts keyed on `(file_id, chunk_index)`, so
   * re-running an interrupted ingestion is safe.
   */
  async function resetStalledKbDocuments(): Promise<number> {
    const result = await getKbDocumentModel().updateMany(
      { status: KbIngestionStatus.PROCESSING },
      {
        $set: {
          status: KbIngestionStatus.PENDING,
          progress: { stage: KbIngestionStage.UPLOADED },
        },
      },
    );
    return result.modifiedCount;
  }

  /**
   * Deletes the KB document and all of its ACL entries. Chunk deletion in
   * pgvector is orchestrated by the caller (packages/api KB service) so the
   * Mongo and PostgreSQL cascades stay in one place.
   */
  async function deleteKbDocument(fileId: string, session?: ClientSession): Promise<DeleteResult> {
    const KbDocumentModel = getKbDocumentModel();
    const options = session ? { session } : {};
    const document = await KbDocumentModel.findOne({ file_id: fileId }, { _id: 1 }, options).lean<
      Pick<IKbDocument, '_id'>
    >();

    if (!document) {
      return { acknowledged: true, deletedCount: 0 };
    }

    await getAclEntryModel().deleteMany(
      { resourceType: ResourceType.KB_DOCUMENT, resourceId: document._id },
      options,
    );
    return await KbDocumentModel.deleteOne({ _id: document._id }, options);
  }

  function groupEntryQuery(
    resourceId: string | Types.ObjectId,
    groupId: string | Types.ObjectId,
  ): Record<string, unknown> {
    return {
      principalType: PrincipalType.GROUP,
      principalId: toObjectId(groupId),
      resourceType: ResourceType.KB_DOCUMENT,
      resourceId: toObjectId(resourceId),
    };
  }

  function userEntryQuery(
    resourceId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Record<string, unknown> {
    return {
      principalType: PrincipalType.USER,
      principalId: toObjectId(userId),
      resourceType: ResourceType.KB_DOCUMENT,
      resourceId: toObjectId(resourceId),
    };
  }

  async function grantKbGroupAccess(
    resourceId: string | Types.ObjectId,
    groupId: string | Types.ObjectId,
    grantedBy?: string | Types.ObjectId,
  ): Promise<IAclEntry | null> {
    return await getAclEntryModel().findOneAndUpdate(
      groupEntryQuery(resourceId, groupId),
      {
        $set: {
          principalModel: PrincipalModel.GROUP,
          permBits: PermissionBits.VIEW,
          grantedAt: new Date(),
          ...(grantedBy && { grantedBy: toObjectId(grantedBy) }),
        },
        $unset: { deny: 1 },
      },
      { upsert: true, new: true },
    );
  }

  async function revokeKbGroupAccess(
    resourceId: string | Types.ObjectId,
    groupId: string | Types.ObjectId,
  ): Promise<DeleteResult> {
    return await getAclEntryModel().deleteOne(groupEntryQuery(resourceId, groupId));
  }

  /**
   * Sets a per-user override on a KB document. An override always wins over
   * group membership: `allow: true` grants access even without any group,
   * `allow: false` writes an explicit deny entry (`permBits: 0`) that removes
   * access granted through groups.
   */
  async function setKbUserOverride(
    resourceId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    allow: boolean,
    grantedBy?: string | Types.ObjectId,
  ): Promise<IAclEntry | null> {
    const update = allow
      ? {
          $set: {
            principalModel: PrincipalModel.USER,
            permBits: PermissionBits.VIEW,
            grantedAt: new Date(),
            ...(grantedBy && { grantedBy: toObjectId(grantedBy) }),
          },
          $unset: { deny: 1 },
        }
      : {
          $set: {
            principalModel: PrincipalModel.USER,
            permBits: 0,
            deny: true,
            grantedAt: new Date(),
            ...(grantedBy && { grantedBy: toObjectId(grantedBy) }),
          },
        };

    return await getAclEntryModel().findOneAndUpdate(userEntryQuery(resourceId, userId), update, {
      upsert: true,
      new: true,
    });
  }

  async function removeKbUserOverride(
    resourceId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<DeleteResult> {
    return await getAclEntryModel().deleteOne(userEntryQuery(resourceId, userId));
  }

  /**
   * Resolves the KB documents a user can read, applying the hybrid model in a
   * single indexed ACL query and one pass over the entries: explicit user
   * denies always win, then user grants and group grants are unioned.
   */
  async function findAccessibleKbResourceIds(
    principals: KbAccessPrincipals,
  ): Promise<Types.ObjectId[]> {
    const userId = toObjectId(principals.userId);
    const groupIds = principals.groupIds.map(toObjectId);

    const principalsQuery: Array<Record<string, unknown>> = [
      { principalType: PrincipalType.USER, principalId: userId },
    ];
    if (groupIds.length > 0) {
      principalsQuery.push({
        principalType: PrincipalType.GROUP,
        principalId: { $in: groupIds },
      });
    }

    const entries = await getAclEntryModel()
      .find(
        { $or: principalsQuery, resourceType: ResourceType.KB_DOCUMENT },
        { resourceId: 1, principalType: 1, permBits: 1, deny: 1 },
      )
      .lean<KbAclProjection[]>();

    const granted = new Map<string, Types.ObjectId>();
    const denied = new Set<string>();

    for (const entry of entries) {
      const key = String(entry.resourceId);
      if (entry.principalType === PrincipalType.USER && entry.deny === true) {
        denied.add(key);
        continue;
      }
      if ((entry.permBits & PermissionBits.VIEW) !== 0) {
        granted.set(key, entry.resourceId);
      }
    }

    const accessible: Types.ObjectId[] = [];
    for (const [key, resourceId] of granted) {
      if (!denied.has(key)) {
        accessible.push(resourceId);
      }
    }
    return accessible;
  }

  /**
   * Resolves the pgvector `file_id`s the user may search. Only fully ingested
   * documents are returned so the vector query never surfaces partial content.
   */
  async function findAccessibleKbFileIds(principals: KbAccessPrincipals): Promise<string[]> {
    const resourceIds = await findAccessibleKbResourceIds(principals);
    if (resourceIds.length === 0) {
      return [];
    }

    const documents = await getKbDocumentModel()
      .find({ _id: { $in: resourceIds }, status: KbIngestionStatus.COMPLETED }, { file_id: 1 })
      .lean<Array<Pick<IKbDocument, 'file_id'>>>();

    return documents.map((document) => document.file_id);
  }

  return {
    createKbDocument,
    findKbDocumentByFileId,
    findKbDocumentById,
    listKbDocuments,
    updateKbIngestion,
    claimNextPendingKbDocument,
    resetStalledKbDocuments,
    deleteKbDocument,
    grantKbGroupAccess,
    revokeKbGroupAccess,
    setKbUserOverride,
    removeKbUserOverride,
    findAccessibleKbResourceIds,
    findAccessibleKbFileIds,
  };
}

export type KbDocumentMethods = ReturnType<typeof createKbDocumentMethods>;
