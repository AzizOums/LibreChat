import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PrincipalType, KbIngestionStatus, KbIngestionStage } from 'librechat-data-provider';
import type * as t from '~/types';
import { createKbDocumentMethods } from './kbDocument';
import kbDocumentSchema from '~/schema/kbDocument';
import aclEntrySchema from '~/schema/aclEntry';

let mongoServer: MongoMemoryServer;
let KbDocument: mongoose.Model<t.IKbDocument>;
let AclEntry: mongoose.Model<t.IAclEntry>;
let methods: ReturnType<typeof createKbDocumentMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  KbDocument = mongoose.models.KbDocument || mongoose.model('KbDocument', kbDocumentSchema);
  AclEntry = mongoose.models.AclEntry || mongoose.model('AclEntry', aclEntrySchema);
  methods = createKbDocumentMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

const userId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();
const hrGroupId = new mongoose.Types.ObjectId();
const salesGroupId = new mongoose.Types.ObjectId();
const adminId = new mongoose.Types.ObjectId();

async function createCompletedDocument(fileId: string): Promise<t.IKbDocument> {
  const document = await methods.createKbDocument({
    file_id: fileId,
    filename: `${fileId}.pdf`,
    type: 'application/pdf',
    bytes: 1024,
    status: KbIngestionStatus.COMPLETED,
    uploadedBy: adminId,
  });
  return document;
}

describe('KbDocument CRUD', () => {
  it('creates and finds a document by file_id', async () => {
    await createCompletedDocument('doc-1');
    const found = await methods.findKbDocumentByFileId('doc-1');
    expect(found).not.toBeNull();
    expect(found?.filename).toBe('doc-1.pdf');
    expect(found?.status).toBe(KbIngestionStatus.COMPLETED);
  });

  it('defaults status to pending', async () => {
    const document = await methods.createKbDocument({
      file_id: 'doc-pending',
      filename: 'doc.pdf',
      type: 'application/pdf',
      bytes: 10,
    });
    expect(document.status).toBe(KbIngestionStatus.PENDING);
  });

  it('rejects duplicate file_id', async () => {
    await createCompletedDocument('doc-dup');
    await expect(createCompletedDocument('doc-dup')).rejects.toThrow();
  });

  it('updates ingestion progress, then clears the error on success', async () => {
    await createCompletedDocument('doc-2');
    let updated = await methods.updateKbIngestion('doc-2', {
      status: KbIngestionStatus.ERROR,
      error: 'embedding provider unreachable',
    });
    expect(updated?.status).toBe(KbIngestionStatus.ERROR);
    expect(updated?.error).toBe('embedding provider unreachable');

    updated = await methods.updateKbIngestion('doc-2', {
      status: KbIngestionStatus.PROCESSING,
      progress: { stage: KbIngestionStage.EMBEDDING, processedChunks: 5, totalChunks: 20 },
      error: null,
    });
    expect(updated?.status).toBe(KbIngestionStatus.PROCESSING);
    expect(updated?.progress?.stage).toBe(KbIngestionStage.EMBEDDING);
    expect(updated?.progress?.processedChunks).toBe(5);
    expect(updated?.error).toBeUndefined();
  });

  it('paginates listKbDocuments with a cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await createCompletedDocument(`doc-list-${i}`);
    }
    const firstPage = await methods.listKbDocuments({ limit: 3 });
    expect(firstPage.documents).toHaveLength(3);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await methods.listKbDocuments({ limit: 3, cursor: firstPage.nextCursor });
    expect(secondPage.documents).toHaveLength(2);
    expect(secondPage.nextCursor).toBeUndefined();

    const ids = new Set([...firstPage.documents, ...secondPage.documents].map((d) => d.file_id));
    expect(ids.size).toBe(5);
  });

  it('deletes a document with its ACL entries', async () => {
    const document = await createCompletedDocument('doc-del');
    await methods.grantKbGroupAccess(document._id, hrGroupId, adminId);
    await methods.setKbUserOverride(document._id, userId, true, adminId);

    const result = await methods.deleteKbDocument('doc-del');
    expect(result.deletedCount).toBe(1);
    expect(await methods.findKbDocumentByFileId('doc-del')).toBeNull();
    expect(await KbDocument.countDocuments({ file_id: 'doc-del' })).toBe(0);
    expect(await AclEntry.countDocuments({ resourceId: document._id })).toBe(0);
  });
});

describe('KB hybrid access resolution', () => {
  it('returns nothing for a user with no rights', async () => {
    await createCompletedDocument('doc-none');
    const fileIds = await methods.findAccessibleKbFileIds({ userId, groupIds: [] });
    expect(fileIds).toEqual([]);
  });

  it('grants access through group membership', async () => {
    const document = await createCompletedDocument('doc-hr');
    await methods.grantKbGroupAccess(document._id, hrGroupId, adminId);

    const fileIds = await methods.findAccessibleKbFileIds({ userId, groupIds: [hrGroupId] });
    expect(fileIds).toEqual(['doc-hr']);

    const outsider = await methods.findAccessibleKbFileIds({
      userId: otherUserId,
      groupIds: [salesGroupId],
    });
    expect(outsider).toEqual([]);
  });

  it('deduplicates a document reachable through multiple groups', async () => {
    const document = await createCompletedDocument('doc-multi');
    await methods.grantKbGroupAccess(document._id, hrGroupId, adminId);
    await methods.grantKbGroupAccess(document._id, salesGroupId, adminId);

    const fileIds = await methods.findAccessibleKbFileIds({
      userId,
      groupIds: [hrGroupId, salesGroupId],
    });
    expect(fileIds).toEqual(['doc-multi']);
  });

  it('grants access through a user override without any group', async () => {
    const document = await createCompletedDocument('doc-user');
    await methods.setKbUserOverride(document._id, userId, true, adminId);

    const fileIds = await methods.findAccessibleKbFileIds({ userId, groupIds: [] });
    expect(fileIds).toEqual(['doc-user']);
  });

  it('user deny overrides a group grant', async () => {
    const document = await createCompletedDocument('doc-deny');
    await methods.grantKbGroupAccess(document._id, hrGroupId, adminId);
    await methods.setKbUserOverride(document._id, userId, false, adminId);

    const denied = await methods.findAccessibleKbFileIds({ userId, groupIds: [hrGroupId] });
    expect(denied).toEqual([]);

    const stillGranted = await methods.findAccessibleKbFileIds({
      userId: otherUserId,
      groupIds: [hrGroupId],
    });
    expect(stillGranted).toEqual(['doc-deny']);
  });

  it('removing a deny restores group access', async () => {
    const document = await createCompletedDocument('doc-restore');
    await methods.grantKbGroupAccess(document._id, hrGroupId, adminId);
    await methods.setKbUserOverride(document._id, userId, false, adminId);
    await methods.removeKbUserOverride(document._id, userId);

    const fileIds = await methods.findAccessibleKbFileIds({ userId, groupIds: [hrGroupId] });
    expect(fileIds).toEqual(['doc-restore']);
  });

  it('flipping an override from deny to allow replaces the entry', async () => {
    const document = await createCompletedDocument('doc-flip');
    await methods.setKbUserOverride(document._id, userId, false, adminId);
    await methods.setKbUserOverride(document._id, userId, true, adminId);

    const entries = await AclEntry.find({
      resourceId: document._id,
      principalType: PrincipalType.USER,
    }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0].deny).toBeUndefined();

    const fileIds = await methods.findAccessibleKbFileIds({ userId, groupIds: [] });
    expect(fileIds).toEqual(['doc-flip']);
  });

  it('revoking group access removes it for members without overrides', async () => {
    const document = await createCompletedDocument('doc-revoke');
    await methods.grantKbGroupAccess(document._id, hrGroupId, adminId);
    await methods.revokeKbGroupAccess(document._id, hrGroupId);

    const fileIds = await methods.findAccessibleKbFileIds({ userId, groupIds: [hrGroupId] });
    expect(fileIds).toEqual([]);
  });

  it('excludes documents that are not fully ingested', async () => {
    const document = await methods.createKbDocument({
      file_id: 'doc-processing',
      filename: 'doc.pdf',
      type: 'application/pdf',
      bytes: 10,
      status: KbIngestionStatus.PROCESSING,
    });
    await methods.grantKbGroupAccess(document._id, hrGroupId, adminId);

    const fileIds = await methods.findAccessibleKbFileIds({ userId, groupIds: [hrGroupId] });
    expect(fileIds).toEqual([]);

    const resourceIds = await methods.findAccessibleKbResourceIds({
      userId,
      groupIds: [hrGroupId],
    });
    expect(resourceIds.map(String)).toEqual([String(document._id)]);
  });

  it('a user removed from a group immediately loses group-granted access', async () => {
    const document = await createCompletedDocument('doc-left-group');
    await methods.grantKbGroupAccess(document._id, hrGroupId, adminId);

    const before = await methods.findAccessibleKbFileIds({ userId, groupIds: [hrGroupId] });
    expect(before).toEqual(['doc-left-group']);

    const after = await methods.findAccessibleKbFileIds({ userId, groupIds: [] });
    expect(after).toEqual([]);
  });

  it('a deny blocks access even when the document is granted to several of the user groups', async () => {
    const document = await createCompletedDocument('doc-deny-multi');
    await methods.grantKbGroupAccess(document._id, hrGroupId, adminId);
    await methods.grantKbGroupAccess(document._id, salesGroupId, adminId);
    await methods.setKbUserOverride(document._id, userId, false, adminId);

    const fileIds = await methods.findAccessibleKbFileIds({
      userId,
      groupIds: [hrGroupId, salesGroupId],
    });
    expect(fileIds).toEqual([]);
  });

  it('claims pending documents atomically and requeues stalled ones', async () => {
    await methods.createKbDocument({
      file_id: 'doc-claim',
      filename: 'doc.pdf',
      type: 'application/pdf',
      bytes: 10,
    });

    const claimed = await methods.claimNextPendingKbDocument();
    expect(claimed?.file_id).toBe('doc-claim');
    expect(claimed?.status).toBe(KbIngestionStatus.PROCESSING);

    const second = await methods.claimNextPendingKbDocument();
    expect(second).toBeNull();

    const requeued = await methods.resetStalledKbDocuments();
    expect(requeued).toBe(1);
    const reclaimed = await methods.claimNextPendingKbDocument();
    expect(reclaimed?.file_id).toBe('doc-claim');
  });

  it('deny entries carry permBits 0 and never match bitwise grant queries', async () => {
    const document = await createCompletedDocument('doc-bits');
    await methods.setKbUserOverride(document._id, userId, false, adminId);

    const entry = await AclEntry.findOne({
      resourceId: document._id,
      principalType: PrincipalType.USER,
    }).lean();
    expect(entry?.deny).toBe(true);
    expect(entry?.permBits).toBe(0);

    const bitwiseMatches = await AclEntry.find({
      resourceId: document._id,
      permBits: { $bitsAllSet: 1 },
    }).lean();
    expect(bitwiseMatches).toHaveLength(0);
  });
});
