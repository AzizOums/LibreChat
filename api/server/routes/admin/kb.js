const fs = require('fs');
const path = require('path');
const multer = require('multer');
const express = require('express');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { createAdminKbHandlers, getKbConfig, deleteKbChunks } = require('@librechat/api');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const paths = require('~/config/paths');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadKb = requireCapability(SystemCapabilities.READ_KB);
const requireManageKb = requireCapability(SystemCapabilities.MANAGE_KB);

const uploadsDir = path.join(paths.uploads, 'kb');
const tempDir = path.join(paths.uploads, 'temp', 'kb');
const maxFileSizeMb = Number.parseInt(process.env.KB_MAX_FILE_SIZE_MB ?? '50', 10) || 50;

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      cb(null, tempDir);
    },
    filename: function (req, file, cb) {
      file.originalname = decodeURIComponent(file.originalname);
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
    },
  }),
  limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
});

const handlers = createAdminKbHandlers({
  kb: {
    createKbDocument: db.createKbDocument,
    findKbDocumentByFileId: db.findKbDocumentByFileId,
    listKbDocuments: db.listKbDocuments,
    updateKbIngestion: db.updateKbIngestion,
    deleteKbDocument: db.deleteKbDocument,
    grantKbGroupAccess: db.grantKbGroupAccess,
    revokeKbGroupAccess: db.revokeKbGroupAccess,
    setKbUserOverride: db.setKbUserOverride,
    removeKbUserOverride: db.removeKbUserOverride,
  },
  findEntriesByResource: db.findEntriesByResource,
  findGroupById: db.findGroupById,
  getUserById: db.getUserById,
  findUsers: db.findUsers,
  deleteChunks: (fileId) => deleteKbChunks(fileId),
  uploadsDir,
  defaultChunking: getKbConfig().chunking,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/documents', requireReadKb, handlers.listDocuments);
router.post('/documents', requireManageKb, upload.single('file'), handlers.uploadDocument);
router.get('/documents/:fileId', requireReadKb, handlers.getDocument);
router.delete('/documents/:fileId', requireManageKb, handlers.deleteDocument);
router.post('/documents/:fileId/retry', requireManageKb, handlers.retryDocument);
router.get('/documents/:fileId/access', requireReadKb, handlers.getDocumentAccess);
router.put('/documents/:fileId/groups/:groupId', requireManageKb, handlers.setGroupAccess);
router.delete('/documents/:fileId/groups/:groupId', requireManageKb, handlers.removeGroupAccess);
router.put('/documents/:fileId/users/:userId', requireManageKb, handlers.setUserOverride);
router.delete('/documents/:fileId/users/:userId', requireManageKb, handlers.removeUserOverride);

module.exports = router;
