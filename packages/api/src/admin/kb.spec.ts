import fs from 'fs';
import os from 'os';
import path from 'path';
import { Types } from 'mongoose';
import { PrincipalType, KbIngestionStatus, KbIngestionStage } from 'librechat-data-provider';
import type { IKbDocument } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminKbDeps } from './kb';
import { createAdminKbHandlers } from './kb';

const validFileId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const groupId = new Types.ObjectId().toHexString();
const userId = new Types.ObjectId().toHexString();

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kb-admin-spec-'));
});

afterAll(async () => {
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
});

function mockDocument(overrides: Partial<IKbDocument> = {}): IKbDocument {
  return {
    _id: new Types.ObjectId(),
    file_id: validFileId,
    filename: 'guide.pdf',
    type: 'application/pdf',
    bytes: 2048,
    status: KbIngestionStatus.COMPLETED,
    ...overrides,
  } as IKbDocument;
}

function createReqRes(
  overrides: {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    file?: { path: string; originalname: string; mimetype: string; size: number };
    user?: { id?: string };
  } = {},
) {
  const req = {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
    file: overrides.file,
    user: overrides.user ?? { id: new Types.ObjectId().toHexString() },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(overrides: Partial<AdminKbDeps> = {}): AdminKbDeps {
  return {
    kb: {
      createKbDocument: jest.fn().mockImplementation((data) => Promise.resolve(mockDocument(data))),
      findKbDocumentByFileId: jest.fn().mockResolvedValue(mockDocument()),
      listKbDocuments: jest.fn().mockResolvedValue({ documents: [mockDocument()] }),
      updateKbIngestion: jest
        .fn()
        .mockResolvedValue(mockDocument({ status: KbIngestionStatus.PENDING })),
      deleteKbDocument: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
      grantKbGroupAccess: jest.fn().mockResolvedValue(null),
      revokeKbGroupAccess: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
      setKbUserOverride: jest.fn().mockResolvedValue(null),
      removeKbUserOverride: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
      ...(overrides.kb ?? {}),
    },
    findEntriesByResource: jest.fn().mockResolvedValue([]),
    findGroupById: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(groupId), name: 'RH' }),
    getUserById: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(userId) }),
    findUsers: jest.fn().mockResolvedValue([]),
    deleteChunks: jest.fn().mockResolvedValue(0),
    uploadsDir: path.join(tempRoot, 'kb'),
    defaultChunking: { chunkSize: 1000, chunkOverlap: 200 },
    ...overrides,
  };
}

describe('createAdminKbHandlers', () => {
  describe('uploadDocument', () => {
    async function makeTempUpload(name: string): Promise<string> {
      const filePath = path.join(tempRoot, name);
      await fs.promises.writeFile(filePath, 'contenu de test');
      return filePath;
    }

    it('rejects a missing file', async () => {
      const handlers = createAdminKbHandlers(createDeps());
      const { req, res, status } = createReqRes();
      await handlers.uploadDocument(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('rejects unsupported file types', async () => {
      const handlers = createAdminKbHandlers(createDeps());
      const tempPath = await makeTempUpload('virus.exe');
      const { req, res, status } = createReqRes({
        file: {
          path: tempPath,
          originalname: 'virus.exe',
          mimetype: 'application/octet-stream',
          size: 10,
        },
      });
      await handlers.uploadDocument(req, res);
      expect(status).toHaveBeenCalledWith(415);
    });

    it('rejects invalid chunking parameters', async () => {
      const handlers = createAdminKbHandlers(createDeps());
      const tempPath = await makeTempUpload('doc-bad-chunking.txt');
      const { req, res, status } = createReqRes({
        file: { path: tempPath, originalname: 'doc.txt', mimetype: 'text/plain', size: 10 },
        body: { chunkSize: 50 },
      });
      await handlers.uploadDocument(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('stores the file and creates a pending document', async () => {
      const deps = createDeps();
      const handlers = createAdminKbHandlers(deps);
      const tempPath = await makeTempUpload('doc-ok.md');
      const { req, res, status, json } = createReqRes({
        file: { path: tempPath, originalname: 'doc.md', mimetype: 'text/markdown', size: 15 },
        body: { chunkSize: 500, chunkOverlap: 50 },
      });
      await handlers.uploadDocument(req, res);

      expect(status).toHaveBeenCalledWith(201);
      const createCall = (deps.kb.createKbDocument as jest.Mock).mock.calls[0][0];
      expect(createCall.status).toBe(KbIngestionStatus.PENDING);
      expect(createCall.progress.stage).toBe(KbIngestionStage.UPLOADED);
      expect(createCall.chunking).toEqual({ chunkSize: 500, chunkOverlap: 50 });
      expect(fs.existsSync(createCall.filepath)).toBe(true);
      expect(path.basename(createCall.filepath)).toBe(`${createCall.file_id}.md`);
      expect(json).toHaveBeenCalledWith({
        document: expect.objectContaining({ file_id: createCall.file_id }),
      });
    });

    it('cleans up the stored file when document creation fails', async () => {
      const deps = createDeps();
      (deps.kb.createKbDocument as jest.Mock).mockRejectedValue(new Error('duplicate'));
      const handlers = createAdminKbHandlers(deps);
      const tempPath = await makeTempUpload('doc-fail.txt');
      const { req, res, status } = createReqRes({
        file: { path: tempPath, originalname: 'doc.txt', mimetype: 'text/plain', size: 15 },
      });
      await handlers.uploadDocument(req, res);

      expect(status).toHaveBeenCalledWith(500);
      const stored = await fs.promises.readdir(path.join(tempRoot, 'kb'));
      expect(stored.filter((f) => f.endsWith('.txt'))).toHaveLength(0);
    });
  });

  describe('listDocuments / getDocument', () => {
    it('rejects an invalid status filter', async () => {
      const handlers = createAdminKbHandlers(createDeps());
      const { req, res, status } = createReqRes({ query: { status: 'bogus' } });
      await handlers.listDocuments(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('caps the list limit', async () => {
      const deps = createDeps();
      const handlers = createAdminKbHandlers(deps);
      const { req, res } = createReqRes({ query: { limit: '5000' } });
      await handlers.listDocuments(req, res);
      expect(deps.kb.listKbDocuments).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
      const { req: req2, res: res2 } = createReqRes({ query: {} });
      await handlers.listDocuments(req2, res2);
      expect(deps.kb.listKbDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: undefined }),
      );
    });

    it('returns 400 for a malformed file id and 404 for a missing document', async () => {
      const deps = createDeps();
      (deps.kb.findKbDocumentByFileId as jest.Mock).mockResolvedValue(null);
      const handlers = createAdminKbHandlers(deps);

      const bad = createReqRes({ params: { fileId: 'not-a-uuid' } });
      await handlers.getDocument(bad.req, bad.res);
      expect(bad.status).toHaveBeenCalledWith(400);

      const missing = createReqRes({ params: { fileId: validFileId } });
      await handlers.getDocument(missing.req, missing.res);
      expect(missing.status).toHaveBeenCalledWith(404);
    });
  });

  describe('deleteDocument', () => {
    it('deletes chunks before the document record', async () => {
      const order: string[] = [];
      const deps = createDeps({
        deleteChunks: jest.fn().mockImplementation(() => {
          order.push('chunks');
          return Promise.resolve(3);
        }),
      });
      (deps.kb.deleteKbDocument as jest.Mock).mockImplementation(() => {
        order.push('document');
        return Promise.resolve({ acknowledged: true, deletedCount: 1 });
      });
      const handlers = createAdminKbHandlers(deps);
      const { req, res, status } = createReqRes({ params: { fileId: validFileId } });
      await handlers.deleteDocument(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(order).toEqual(['chunks', 'document']);
    });

    it('does not delete the document when chunk deletion fails', async () => {
      const deps = createDeps({
        deleteChunks: jest.fn().mockRejectedValue(new Error('pg unavailable')),
      });
      const handlers = createAdminKbHandlers(deps);
      const { req, res, status } = createReqRes({ params: { fileId: validFileId } });
      await handlers.deleteDocument(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(deps.kb.deleteKbDocument).not.toHaveBeenCalled();
    });
  });

  describe('retryDocument', () => {
    it('only retries documents in error state', async () => {
      const deps = createDeps();
      (deps.kb.findKbDocumentByFileId as jest.Mock).mockResolvedValue(
        mockDocument({ status: KbIngestionStatus.COMPLETED }),
      );
      const handlers = createAdminKbHandlers(deps);
      const { req, res, status } = createReqRes({ params: { fileId: validFileId } });
      await handlers.retryDocument(req, res);
      expect(status).toHaveBeenCalledWith(409);
      expect(deps.deleteChunks).not.toHaveBeenCalled();
    });

    it('purges chunks and resets the document to pending', async () => {
      const deps = createDeps();
      (deps.kb.findKbDocumentByFileId as jest.Mock).mockResolvedValue(
        mockDocument({ status: KbIngestionStatus.ERROR, error: 'boom' }),
      );
      const handlers = createAdminKbHandlers(deps);
      const { req, res, status } = createReqRes({ params: { fileId: validFileId } });
      await handlers.retryDocument(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.deleteChunks).toHaveBeenCalledWith(validFileId);
      expect(deps.kb.updateKbIngestion).toHaveBeenCalledWith(validFileId, {
        status: KbIngestionStatus.PENDING,
        progress: { stage: KbIngestionStage.UPLOADED },
        chunkCount: 0,
        error: null,
      });
    });
  });

  describe('access management', () => {
    it('grants group access after validating the group exists', async () => {
      const deps = createDeps();
      const handlers = createAdminKbHandlers(deps);
      const { req, res, status } = createReqRes({ params: { fileId: validFileId, groupId } });
      await handlers.setGroupAccess(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.kb.grantKbGroupAccess).toHaveBeenCalled();
    });

    it('returns 404 when granting access to a missing group', async () => {
      const deps = createDeps({ findGroupById: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminKbHandlers(deps);
      const { req, res, status } = createReqRes({ params: { fileId: validFileId, groupId } });
      await handlers.setGroupAccess(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(deps.kb.grantKbGroupAccess).not.toHaveBeenCalled();
    });

    it('requires a boolean allow flag for user overrides', async () => {
      const deps = createDeps();
      const handlers = createAdminKbHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { fileId: validFileId, userId },
        body: { allow: 'yes' },
      });
      await handlers.setUserOverride(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.kb.setKbUserOverride).not.toHaveBeenCalled();
    });

    it('sets a deny override for an existing user', async () => {
      const deps = createDeps();
      const handlers = createAdminKbHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { fileId: validFileId, userId },
        body: { allow: false },
      });
      await handlers.setUserOverride(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.kb.setKbUserOverride).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        false,
        expect.anything(),
      );
    });

    it('hydrates access entries with user and group details', async () => {
      const document = mockDocument();
      const memberId = new Types.ObjectId();
      const deps = createDeps({
        findEntriesByResource: jest.fn().mockResolvedValue([
          {
            principalType: PrincipalType.USER,
            principalId: memberId,
            permBits: 0,
            deny: true,
            grantedAt: new Date(),
          },
          {
            principalType: PrincipalType.GROUP,
            principalId: new Types.ObjectId(groupId),
            permBits: 1,
            grantedAt: new Date(),
          },
        ]),
        findUsers: jest.fn().mockResolvedValue([{ _id: memberId, name: 'Jo', email: 'jo@x.io' }]),
      });
      (deps.kb.findKbDocumentByFileId as jest.Mock).mockResolvedValue(document);
      const handlers = createAdminKbHandlers(deps);
      const { req, res, json } = createReqRes({ params: { fileId: validFileId } });
      await handlers.getDocumentAccess(req, res);

      const payload = json.mock.calls[0][0];
      expect(payload.users).toEqual([expect.objectContaining({ email: 'jo@x.io', deny: true })]);
      expect(payload.groups).toEqual([expect.objectContaining({ name: 'RH', deny: false })]);
    });
  });
});
