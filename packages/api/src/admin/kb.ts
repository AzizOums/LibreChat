import { randomUUID } from 'crypto';
import { logger } from '@librechat/data-schemas';
import {
  PrincipalType,
  ResourceType,
  KbIngestionStage,
  KbIngestionStatus,
} from 'librechat-data-provider';
import type {
  IUser,
  IGroup,
  IAclEntry,
  IKbDocument,
  KbChunkingParams,
  KbDocumentMethods,
} from '@librechat/data-schemas';
import { Types } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { saveKbSource, deleteKbSource } from '~/kb/storage';

interface KbFileParams {
  fileId: string;
}

interface KbGroupParams extends KbFileParams {
  groupId: string;
}

interface KbUserParams extends KbFileParams {
  userId: string;
}

interface KbUploadRequest extends ServerRequest {
  file?: Express.Multer.File;
}

interface KbAccessPrincipalEntry {
  principalId: string;
  name?: string;
  email?: string;
  avatar?: string;
  deny: boolean;
  grantedAt?: Date;
}

export interface AdminKbDeps {
  kb: Pick<
    KbDocumentMethods,
    | 'createKbDocument'
    | 'findKbDocumentByFileId'
    | 'listKbDocuments'
    | 'updateKbIngestion'
    | 'deleteKbDocument'
    | 'grantKbGroupAccess'
    | 'revokeKbGroupAccess'
    | 'setKbUserOverride'
    | 'removeKbUserOverride'
  >;
  findEntriesByResource: (
    resourceType: string,
    resourceId: string | Types.ObjectId,
  ) => Promise<IAclEntry[]>;
  findGroupById: (groupId: string | Types.ObjectId) => Promise<IGroup | null>;
  getUserById: (userId: string, fieldsToSelect?: string | string[] | null) => Promise<IUser | null>;
  findUsers: (
    searchCriteria: Record<string, unknown>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IUser[]>;
  deleteChunks: (fileId: string) => Promise<number>;
  uploadsDir: string;
  defaultChunking: KbChunkingParams;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const MAX_LIST_LIMIT = 100;
const MIN_CHUNK_SIZE = 100;
const MAX_CHUNK_SIZE = 8000;

const KB_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
]);

const KB_EXTENSIONS: ReadonlySet<string> = new Set(['.pdf', '.docx', '.txt', '.md', '.markdown']);

function isSupportedKbFile(file: Express.Multer.File): boolean {
  if (KB_MIME_TYPES.has(file.mimetype)) {
    return true;
  }
  const extension = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
  return KB_EXTENSIONS.has(extension);
}

function parseChunking(
  body: { chunkSize?: unknown; chunkOverlap?: unknown },
  defaults: KbChunkingParams,
): KbChunkingParams | { error: string } {
  const chunkSize = body.chunkSize == null ? defaults.chunkSize : Number(body.chunkSize);
  const chunkOverlap =
    body.chunkOverlap == null ? defaults.chunkOverlap : Number(body.chunkOverlap);

  if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) {
    return {
      error: `chunkSize must be an integer between ${MIN_CHUNK_SIZE} and ${MAX_CHUNK_SIZE}`,
    };
  }
  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    return { error: 'chunkOverlap must be a non-negative integer smaller than chunkSize' };
  }
  return { chunkSize, chunkOverlap };
}

export function createAdminKbHandlers(deps: AdminKbDeps): {
  listDocuments: (req: ServerRequest, res: Response) => Promise<Response>;
  getDocument: (req: ServerRequest, res: Response) => Promise<Response>;
  uploadDocument: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteDocument: (req: ServerRequest, res: Response) => Promise<Response>;
  retryDocument: (req: ServerRequest, res: Response) => Promise<Response>;
  getDocumentAccess: (req: ServerRequest, res: Response) => Promise<Response>;
  setGroupAccess: (req: ServerRequest, res: Response) => Promise<Response>;
  removeGroupAccess: (req: ServerRequest, res: Response) => Promise<Response>;
  setUserOverride: (req: ServerRequest, res: Response) => Promise<Response>;
  removeUserOverride: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    kb,
    findEntriesByResource,
    findGroupById,
    getUserById,
    findUsers,
    deleteChunks,
    uploadsDir,
    defaultChunking,
  } = deps;

  async function findDocumentOr404(fileId: string, res: Response): Promise<IKbDocument | null> {
    if (!UUID_PATTERN.test(fileId)) {
      res.status(400).json({ error: 'Invalid file ID format' });
      return null;
    }
    const document = await kb.findKbDocumentByFileId(fileId);
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return null;
    }
    return document;
  }

  async function listDocumentsHandler(req: ServerRequest, res: Response) {
    try {
      const {
        status,
        cursor,
        limit: rawLimit,
      } = req.query as {
        status?: string;
        cursor?: string;
        limit?: string;
      };

      if (status && !Object.values(KbIngestionStatus).includes(status as KbIngestionStatus)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      if (cursor && !OBJECT_ID_PATTERN.test(cursor)) {
        return res.status(400).json({ error: 'Invalid cursor format' });
      }

      const parsedLimit = Number(rawLimit);
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, MAX_LIST_LIMIT)
          : undefined;

      const result = await kb.listKbDocuments({
        status: status as KbIngestionStatus | undefined,
        cursor,
        limit,
      });
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[adminKb] listDocuments error:', error);
      return res.status(500).json({ error: 'Failed to list documents' });
    }
  }

  async function getDocumentHandler(req: ServerRequest, res: Response) {
    try {
      const { fileId } = req.params as unknown as KbFileParams;
      const document = await findDocumentOr404(fileId, res);
      if (!document) {
        return res;
      }
      return res.status(200).json({ document });
    } catch (error) {
      logger.error('[adminKb] getDocument error:', error);
      return res.status(500).json({ error: 'Failed to get document' });
    }
  }

  async function uploadDocumentHandler(req: ServerRequest, res: Response) {
    const file = (req as KbUploadRequest).file;
    try {
      if (!file) {
        return res.status(400).json({ error: 'A file is required' });
      }
      if (!isSupportedKbFile(file)) {
        return res.status(415).json({
          error: 'Unsupported file type. Supported: PDF, DOCX, TXT, Markdown',
        });
      }

      const body = (req.body ?? {}) as { chunkSize?: unknown; chunkOverlap?: unknown };
      const chunking = parseChunking(body, defaultChunking);
      if ('error' in chunking) {
        return res.status(400).json({ error: chunking.error });
      }

      const uploaderId = req.user?.id;
      if (!uploaderId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const fileId = randomUUID();
      const filepath = await saveKbSource({
        tempPath: file.path,
        uploadsDir,
        fileId,
        filename: file.originalname,
      });

      try {
        const document = await kb.createKbDocument({
          file_id: fileId,
          filename: file.originalname,
          type: file.mimetype,
          bytes: file.size,
          status: KbIngestionStatus.PENDING,
          progress: { stage: KbIngestionStage.UPLOADED },
          chunking,
          filepath,
          source: 'local',
          uploadedBy: new Types.ObjectId(uploaderId),
        });
        return res.status(201).json({ document });
      } catch (error) {
        await deleteKbSource(filepath, uploadsDir);
        throw error;
      }
    } catch (error) {
      logger.error('[adminKb] uploadDocument error:', error);
      return res.status(500).json({ error: 'Failed to upload document' });
    }
  }

  async function deleteDocumentHandler(req: ServerRequest, res: Response) {
    try {
      const { fileId } = req.params as unknown as KbFileParams;
      const document = await findDocumentOr404(fileId, res);
      if (!document) {
        return res;
      }

      await deleteChunks(fileId);
      await kb.deleteKbDocument(fileId);
      if (document.filepath) {
        await deleteKbSource(document.filepath, uploadsDir);
      }
      return res.status(200).json({ deleted: true, file_id: fileId });
    } catch (error) {
      logger.error('[adminKb] deleteDocument error:', error);
      return res.status(500).json({ error: 'Failed to delete document' });
    }
  }

  async function retryDocumentHandler(req: ServerRequest, res: Response) {
    try {
      const { fileId } = req.params as unknown as KbFileParams;
      const document = await findDocumentOr404(fileId, res);
      if (!document) {
        return res;
      }
      if (document.status !== KbIngestionStatus.ERROR) {
        return res.status(409).json({ error: 'Only failed documents can be retried' });
      }

      await deleteChunks(fileId);
      const updated = await kb.updateKbIngestion(fileId, {
        status: KbIngestionStatus.PENDING,
        progress: { stage: KbIngestionStage.UPLOADED },
        chunkCount: 0,
        error: null,
      });
      return res.status(200).json({ document: updated });
    } catch (error) {
      logger.error('[adminKb] retryDocument error:', error);
      return res.status(500).json({ error: 'Failed to retry document' });
    }
  }

  async function getDocumentAccessHandler(req: ServerRequest, res: Response) {
    try {
      const { fileId } = req.params as unknown as KbFileParams;
      const document = await findDocumentOr404(fileId, res);
      if (!document) {
        return res;
      }

      const entries = await findEntriesByResource(ResourceType.KB_DOCUMENT, document._id);
      const userEntries = new Map<string, IAclEntry>();
      const groupEntries = new Map<string, IAclEntry>();
      for (const entry of entries) {
        const principalId = String(entry.principalId);
        if (entry.principalType === PrincipalType.USER) {
          userEntries.set(principalId, entry);
        } else if (entry.principalType === PrincipalType.GROUP) {
          groupEntries.set(principalId, entry);
        }
      }

      const [users, groups] = await Promise.all([
        userEntries.size > 0
          ? findUsers({ _id: { $in: [...userEntries.keys()] } }, 'name email username avatar')
          : Promise.resolve([]),
        Promise.all([...groupEntries.keys()].map((groupId) => findGroupById(groupId))),
      ]);

      const userAccess: KbAccessPrincipalEntry[] = [];
      for (const user of users) {
        const entry = userEntries.get(String(user._id));
        if (!entry) {
          continue;
        }
        userAccess.push({
          principalId: String(user._id),
          name: user.name,
          email: user.email,
          avatar: user.avatar ?? undefined,
          deny: entry.deny === true,
          grantedAt: entry.grantedAt,
        });
      }

      const groupAccess: KbAccessPrincipalEntry[] = [];
      for (const group of groups) {
        if (!group) {
          continue;
        }
        const entry = groupEntries.get(String(group._id));
        if (!entry) {
          continue;
        }
        groupAccess.push({
          principalId: String(group._id),
          name: group.name,
          avatar: group.avatar,
          deny: false,
          grantedAt: entry.grantedAt,
        });
      }

      return res.status(200).json({
        file_id: fileId,
        groups: groupAccess,
        users: userAccess,
      });
    } catch (error) {
      logger.error('[adminKb] getDocumentAccess error:', error);
      return res.status(500).json({ error: 'Failed to get document access' });
    }
  }

  async function setGroupAccessHandler(req: ServerRequest, res: Response) {
    try {
      const { fileId, groupId } = req.params as unknown as KbGroupParams;
      if (!OBJECT_ID_PATTERN.test(groupId)) {
        return res.status(400).json({ error: 'Invalid group ID format' });
      }
      const document = await findDocumentOr404(fileId, res);
      if (!document) {
        return res;
      }
      const group = await findGroupById(groupId);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      await kb.grantKbGroupAccess(document._id, groupId, req.user?.id);
      return res.status(200).json({ granted: true, file_id: fileId, groupId });
    } catch (error) {
      logger.error('[adminKb] setGroupAccess error:', error);
      return res.status(500).json({ error: 'Failed to grant group access' });
    }
  }

  async function removeGroupAccessHandler(req: ServerRequest, res: Response) {
    try {
      const { fileId, groupId } = req.params as unknown as KbGroupParams;
      if (!OBJECT_ID_PATTERN.test(groupId)) {
        return res.status(400).json({ error: 'Invalid group ID format' });
      }
      const document = await findDocumentOr404(fileId, res);
      if (!document) {
        return res;
      }

      await kb.revokeKbGroupAccess(document._id, groupId);
      return res.status(200).json({ revoked: true, file_id: fileId, groupId });
    } catch (error) {
      logger.error('[adminKb] removeGroupAccess error:', error);
      return res.status(500).json({ error: 'Failed to revoke group access' });
    }
  }

  async function setUserOverrideHandler(req: ServerRequest, res: Response) {
    try {
      const { fileId, userId } = req.params as unknown as KbUserParams;
      if (!OBJECT_ID_PATTERN.test(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      const { allow } = (req.body ?? {}) as { allow?: unknown };
      if (typeof allow !== 'boolean') {
        return res.status(400).json({ error: 'allow must be a boolean' });
      }

      const document = await findDocumentOr404(fileId, res);
      if (!document) {
        return res;
      }
      const user = await getUserById(userId, '_id');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      await kb.setKbUserOverride(document._id, userId, allow, req.user?.id);
      return res.status(200).json({ file_id: fileId, userId, allow });
    } catch (error) {
      logger.error('[adminKb] setUserOverride error:', error);
      return res.status(500).json({ error: 'Failed to set user override' });
    }
  }

  async function removeUserOverrideHandler(req: ServerRequest, res: Response) {
    try {
      const { fileId, userId } = req.params as unknown as KbUserParams;
      if (!OBJECT_ID_PATTERN.test(userId)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      const document = await findDocumentOr404(fileId, res);
      if (!document) {
        return res;
      }

      await kb.removeKbUserOverride(document._id, userId);
      return res.status(200).json({ removed: true, file_id: fileId, userId });
    } catch (error) {
      logger.error('[adminKb] removeUserOverride error:', error);
      return res.status(500).json({ error: 'Failed to remove user override' });
    }
  }

  return {
    listDocuments: listDocumentsHandler,
    getDocument: getDocumentHandler,
    uploadDocument: uploadDocumentHandler,
    deleteDocument: deleteDocumentHandler,
    retryDocument: retryDocumentHandler,
    getDocumentAccess: getDocumentAccessHandler,
    setGroupAccess: setGroupAccessHandler,
    removeGroupAccess: removeGroupAccessHandler,
    setUserOverride: setUserOverrideHandler,
    removeUserOverride: removeUserOverrideHandler,
  };
}
