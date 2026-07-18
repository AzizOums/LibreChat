import { Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  IUser,
  IConfig,
  AdminUserListItem,
  AdminUserSearchResult,
  UserDeleteResult,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';

const MAX_SEARCH_LENGTH = 200;
const MAX_EMAIL_LENGTH = 500;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USER_LIST_FIELDS = '_id name username email avatar role provider createdAt updatedAt';

interface CreateUserBody {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  username?: unknown;
  role?: unknown;
  emailVerified?: unknown;
}

interface InviteUserBody {
  email?: unknown;
}

export interface RegisterUserResult {
  status: number;
  message: string;
}

export interface AdminUsersDeps {
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  countUsers: (filter?: FilterQuery<IUser>) => Promise<number>;
  /**
   * Thin data-layer delete — removes the User document only.
   * Full cascade of user-owned resources (conversations, messages, files, tokens, etc.)
   * is handled by `UserController.deleteUserController` in the self-delete flow.
   * This admin endpoint currently cascades Config and AclEntries.
   * A future iteration should consolidate the full cascade into a shared service function.
   */
  deleteUserById: (userId: string) => Promise<UserDeleteResult>;
  deleteConfig: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
  ) => Promise<IConfig | null>;
  deleteAclEntries: (filter: {
    principalType: PrincipalType;
    principalId: string | Types.ObjectId;
  }) => Promise<void>;
  registerUser: (
    user: { email: string; password: string; name: string; username?: string },
    additionalData?: Partial<IUser>,
  ) => Promise<RegisterUserResult>;
  createInviteToken: (email: string) => Promise<string | { message: string }>;
  emailEnabled: () => boolean;
  sendInviteEmail: (params: { email: string; inviteLink: string }) => Promise<void>;
  /** Base client URL used to build invite links (e.g. process.env.DOMAIN_CLIENT). */
  clientDomain: string;
}

export function createAdminUsersHandlers(deps: AdminUsersDeps): {
  listUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  searchUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  createUser: (req: ServerRequest, res: Response) => Promise<Response>;
  inviteUser: (req: ServerRequest, res: Response) => Promise<Response>;
  deleteUser: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    findUsers,
    countUsers,
    deleteUserById,
    deleteConfig,
    deleteAclEntries,
    registerUser,
    createInviteToken,
    emailEnabled,
    sendInviteEmail,
    clientDomain,
  } = deps;

  function validateEmail(email: unknown): string | null {
    if (typeof email !== 'string') {
      return null;
    }
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  async function listUsersHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);
      const [users, total] = await Promise.all([
        findUsers({}, USER_LIST_FIELDS, { limit, offset, sort: { createdAt: -1 } }),
        countUsers(),
      ]);

      const mapped: AdminUserListItem[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        username: u.username ?? '',
        email: u.email ?? '',
        avatar: u.avatar ?? '',
        role: u.role ?? 'USER',
        provider: u.provider ?? 'local',
        createdAt: u.createdAt?.toISOString(),
        updatedAt: u.updatedAt?.toISOString(),
      }));

      return res.status(200).json({ users: mapped, total, limit, offset });
    } catch (error) {
      logger.error('[adminUsers] listUsers error:', error);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  async function searchUsersHandler(req: ServerRequest, res: Response) {
    try {
      const rawQ = req.query.q;
      const rawLimit = req.query.limit;
      const query = typeof rawQ === 'string' ? rawQ : undefined;
      const limitStr = typeof rawLimit === 'string' ? rawLimit : '20';
      const trimmed = query?.trim() ?? '';

      if (!trimmed) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
      }

      if (trimmed.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
      }

      if (trimmed.length > MAX_SEARCH_LENGTH) {
        return res
          .status(400)
          .json({ error: `Query must not exceed ${MAX_SEARCH_LENGTH} characters` });
      }

      const searchLimit = Math.min(Math.max(1, parseInt(limitStr, 10) || 20), 50);
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escaped}`, 'i');

      const users = await findUsers(
        { $or: [{ name: regex }, { email: regex }, { username: regex }] },
        '_id name email username avatar',
        { limit: searchLimit, sort: { name: 1 } },
      );

      const results: AdminUserSearchResult[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        email: u.email ?? '',
        username: u.username,
        avatarUrl: u.avatar,
      }));

      return res
        .status(200)
        .json({ users: results, total: results.length, capped: results.length >= searchLimit });
    } catch (error) {
      logger.error('[adminUsers] searchUsers error:', error);
      return res.status(500).json({ error: 'Failed to search users' });
    }
  }

  async function createUserHandler(req: ServerRequest, res: Response) {
    try {
      const body = (req.body ?? {}) as CreateUserBody;
      const email = validateEmail(body.email);
      if (!email) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      if (body.role != null && body.role !== SystemRoles.USER && body.role !== SystemRoles.ADMIN) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      if (body.password != null && typeof body.password !== 'string') {
        return res.status(400).json({ error: 'Invalid password' });
      }

      const [existing] = await findUsers({ email }, '_id', { limit: 1 });
      if (existing) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }

      const name =
        typeof body.name === 'string' && body.name.trim() ? body.name.trim() : email.split('@')[0];
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password =
        typeof body.password === 'string' && body.password
          ? body.password
          : randomBytes(24).toString('base64url');

      const result = await registerUser(
        { email, password, name, username },
        {
          role: (body.role as IUser['role']) ?? SystemRoles.USER,
          emailVerified: body.emailVerified !== false,
        },
      );

      if (result.status !== 200) {
        return res.status(result.status).json({ error: result.message });
      }

      const [user] = await findUsers({ email }, USER_LIST_FIELDS, { limit: 1 });
      if (!user) {
        return res.status(500).json({ error: 'User creation could not be confirmed' });
      }

      const created: AdminUserListItem = {
        id: user._id?.toString() ?? '',
        name: user.name ?? '',
        username: user.username ?? '',
        email: user.email ?? '',
        avatar: user.avatar ?? '',
        role: user.role ?? 'USER',
        provider: user.provider ?? 'local',
        createdAt: user.createdAt?.toISOString(),
        updatedAt: user.updatedAt?.toISOString(),
      };
      return res.status(201).json({ user: created });
    } catch (error) {
      logger.error('[adminUsers] createUser error:', error);
      return res.status(500).json({ error: 'Failed to create user' });
    }
  }

  async function inviteUserHandler(req: ServerRequest, res: Response) {
    try {
      const body = (req.body ?? {}) as InviteUserBody;
      const email = validateEmail(body.email);
      if (!email) {
        return res.status(400).json({ error: 'A valid email is required' });
      }

      const [existing] = await findUsers({ email }, '_id', { limit: 1 });
      if (existing) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }

      const token = await createInviteToken(email);
      if (typeof token !== 'string') {
        return res.status(500).json({ error: token.message });
      }

      const inviteLink = `${clientDomain}/register?token=${token}&email=${encodeURIComponent(email)}`;
      let emailSent = false;
      if (emailEnabled()) {
        try {
          await sendInviteEmail({ email, inviteLink });
          emailSent = true;
        } catch (error) {
          logger.error('[adminUsers] inviteUser email send failed:', error);
        }
      }

      return res.status(201).json({ email, inviteLink, emailSent });
    } catch (error) {
      logger.error('[adminUsers] inviteUser error:', error);
      return res.status(500).json({ error: 'Failed to invite user' });
    }
  }

  async function deleteUserHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const callerId = req.user?._id?.toString() ?? req.user?.id;
      if (callerId === id) {
        return res.status(403).json({ error: 'Cannot delete your own account' });
      }

      const [targetUser] = await findUsers({ _id: id }, 'role', { limit: 1 });
      if (targetUser?.role === SystemRoles.ADMIN) {
        const adminCount = await countUsers({ role: SystemRoles.ADMIN });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last admin user' });
        }
      }

      const result = await deleteUserById(id);

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (targetUser?.role === SystemRoles.ADMIN) {
        const remaining = await countUsers({ role: SystemRoles.ADMIN });
        if (remaining === 0) {
          logger.error(
            `[adminUsers] CRITICAL: last admin deleted via race condition, user: ${id}. ` +
              'Manual DB intervention required to restore an ADMIN user.',
          );
        }
      }

      const objectId = new Types.ObjectId(id);
      const cleanupResults = await Promise.allSettled([
        deleteConfig(PrincipalType.USER, id),
        deleteAclEntries({ principalType: PrincipalType.USER, principalId: objectId }),
      ]);
      for (const r of cleanupResults) {
        if (r.status === 'rejected') {
          logger.error('[adminUsers] cascade cleanup failed for user:', id, r.reason);
        }
      }

      return res.status(200).json({ message: result.message || 'User deleted successfully' });
    } catch (error) {
      logger.error('[adminUsers] deleteUser error:', error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  }

  return {
    listUsers: listUsersHandler,
    searchUsers: searchUsersHandler,
    createUser: createUserHandler,
    inviteUser: inviteUserHandler,
    deleteUser: deleteUserHandler,
  };
}
