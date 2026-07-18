const express = require('express');
const { createAdminUsersHandlers, createInvite, checkEmailConfig } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { registerUser } = require('~/server/services/AuthService');
const { requireJwtAuth } = require('~/server/middleware');
const { sendEmail } = require('~/server/utils');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const appName = process.env.APP_TITLE || 'LibreChat';

const handlers = createAdminUsersHandlers({
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  deleteUserById: db.deleteUserById,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
  registerUser,
  createInviteToken: (email) =>
    createInvite(email, { createToken: db.createToken, findToken: db.findToken }),
  emailEnabled: checkEmailConfig,
  sendInviteEmail: ({ email, inviteLink }) =>
    sendEmail({
      email,
      subject: `Invite to join ${appName}!`,
      payload: {
        appName,
        inviteLink,
        year: new Date().getFullYear(),
      },
      template: 'inviteUser.handlebars',
    }),
  clientDomain: process.env.DOMAIN_CLIENT || 'http://localhost:3080',
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, handlers.listUsers);
router.get('/search', requireReadUsers, handlers.searchUsers);
router.post('/', requireManageUsers, handlers.createUser);
router.post('/invite', requireManageUsers, handlers.inviteUser);
router.delete('/:id', requireManageUsers, handlers.deleteUser);

module.exports = router;
