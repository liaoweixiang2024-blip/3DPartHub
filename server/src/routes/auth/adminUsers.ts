import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Router, Response } from 'express';
import { getBusinessConfig } from '../../lib/businessConfig.js';
import { storePasswordResetToken } from '../../lib/captcha.js';
import { sendPasswordResetEmail } from '../../lib/email.js';
import { revokeAllTokensBefore } from '../../lib/jwt.js';
import { hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { requestSiteUrl } from '../../lib/requestSiteUrl.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';

const RESET_TOKEN_TTL_SECONDS = 1800;
const PASSWORD_MIN_LENGTH = 8;
const USER_ROLES = ['ADMIN', 'EDITOR', 'VIEWER'] as const;
type UserRole = (typeof USER_ROLES)[number];
const USER_SORTS = ['created_at', 'downloads', 'favorites', 'last_login'] as const;
type UserSort = (typeof USER_SORTS)[number];
const USER_EDITABLE_TEXT_FIELDS = ['company', 'phone', 'department', 'bio'] as const;
const EXPORT_LIMIT = 5000;
const BATCH_LIMIT = 200;

function routeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function queryRole(value: unknown): UserRole | undefined {
  const role = Array.isArray(value) ? value[0] : value;
  return USER_ROLES.includes(role as UserRole) ? (role as UserRole) : undefined;
}

function querySort(value: unknown): UserSort {
  const sort = Array.isArray(value) ? value[0] : value;
  return USER_SORTS.includes(sort as UserSort) ? (sort as UserSort) : 'created_at';
}

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((id) => String(id)).filter(Boolean))).slice(0, BATCH_LIMIT);
}

function escapeCsvField(value: unknown): string {
  const str = value == null ? '' : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function resolveOrderBy(sort: UserSort, order: 'asc' | 'desc'): Prisma.UserOrderByWithRelationInput {
  if (sort === 'downloads') return { downloads: { _count: order } };
  if (sort === 'favorites') return { favorites: { _count: order } };
  if (sort === 'last_login') return { lastLoginAt: { sort: order, nulls: 'last' } };
  return { createdAt: order };
}

const userListItemSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  company: true,
  phone: true,
  department: true,
  disabled: true,
  lastLoginAt: true,
  avatar: true,
  bio: true,
  mustChangePassword: true,
  canInvite: true,
  createdAt: true,
  _count: { select: { downloads: true, favorites: true } },
} satisfies Prisma.UserSelect;

function buildListWhere(query: Record<string, unknown>): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  const role = queryRole(query.role);
  if (role) where.role = role;
  if (query.disabled === 'true') where.disabled = true;
  if (query.disabled === 'false') where.disabled = false;
  const search = typeof query.search === 'string' ? query.search : undefined;
  if (search) {
    where.OR = [
      { username: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { company: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}

/**
 * 若该变更会减少"在用管理员"（role=ADMIN 且未禁用）数量，且当前只剩 1 个在用管理员，返回 true。
 * 用于阻止降级 / 禁用 / 删除最后一个在用管理员。targetRemainsActiveAdmin=true 表示变更后仍是活跃管理员（无需保护）。
 */
async function wouldLoseLastActiveAdmin(
  tx: Prisma.TransactionClient,
  targetId: string,
  targetRemainsActiveAdmin: boolean,
): Promise<boolean> {
  if (targetRemainsActiveAdmin) return false;
  const current = await tx.user.findUnique({ where: { id: targetId }, select: { role: true, disabled: true } });
  if (!current || current.role !== 'ADMIN' || current.disabled) return false;
  const activeAdminCount = await tx.user.count({ where: { role: 'ADMIN', disabled: false } });
  return activeAdminCount <= 1;
}

/** 统一抛出带 code 的错误，便于事务内 catch 分流。 */
function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export function createAdminUsersRouter() {
  const router = Router();

  // ===== Stats =====
  router.get('/api/admin/users/stats', authMiddleware, requireRole('ADMIN'), async (_req, res: Response) => {
    try {
      const { cacheGetOrSet } = await import('../../lib/cache.js');
      const { value } = await cacheGetOrSet('cache:admin:users:stats', 60, async () => {
        const [total, roleGroups, active, disabled] = await Promise.all([
          prisma.user.count(),
          prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
          prisma.user.count({ where: { OR: [{ downloads: { some: {} } }, { favorites: { some: {} } }] } }),
          prisma.user.count({ where: { disabled: true } }),
        ]);
        const roleCounts = Object.fromEntries(roleGroups.map((item) => [item.role, item._count._all]));
        return {
          total,
          admin: roleCounts.ADMIN || 0,
          editor: roleCounts.EDITOR || 0,
          viewer: roleCounts.VIEWER || 0,
          active,
          disabled,
        };
      });
      res.json(value);
    } catch {
      res.status(500).json({ detail: '获取用户统计失败' });
    }
  });

  // ===== List =====
  router.get('/api/admin/users', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    try {
      const { pageSizePolicy } = await getBusinessConfig();
      const defaultPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.adminUserDefault) || 20));
      const maxPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.adminUserMax) || 100));
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(maxPageSize, Math.max(1, Number(req.query.page_size) || defaultPageSize));
      const sort = querySort(req.query.sort);
      const order = req.query.order === 'asc' ? 'asc' : 'desc';
      const where = buildListWhere(req.query as Record<string, unknown>);

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: resolveOrderBy(sort, order),
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: userListItemSelect,
        }),
        prisma.user.count({ where }),
      ]);

      res.json({ total, items: users, page, pageSize });
    } catch {
      res.status(500).json({ detail: '获取用户列表失败' });
    }
  });

  // ===== Export CSV =====
  router.get(
    '/api/admin/users/export',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      try {
        const sort = querySort(req.query.sort);
        const order = req.query.order === 'asc' ? 'asc' : 'desc';
        const where = buildListWhere(req.query as Record<string, unknown>);
        const users = await prisma.user.findMany({
          where,
          orderBy: resolveOrderBy(sort, order),
          take: EXPORT_LIMIT,
          select: userListItemSelect,
        });
        const header = [
          '用户名',
          '邮箱',
          '角色',
          '公司',
          '部门',
          '电话',
          '禁用',
          '下载',
          '收藏',
          '注册时间',
          '最近登录',
        ];
        const rows = users.map((u) => [
          u.username,
          u.email,
          u.role,
          u.company ?? '',
          u.department ?? '',
          u.phone ?? '',
          u.disabled ? '是' : '否',
          u._count.downloads,
          u._count.favorites,
          u.createdAt.toISOString(),
          u.lastLoginAt ? u.lastLoginAt.toISOString() : '',
        ]);
        const csv = [header, ...rows].map((r) => r.map(escapeCsvField).join(',')).join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
        res.send('\uFEFF' + csv); // BOM 避免 Excel 中文乱码
      } catch {
        res.status(500).json({ detail: '导出失败' });
      }
    },
  );

  // ===== Audit history for a user =====
  router.get(
    '/api/admin/users/:id/audit',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const userId = routeParam(req.params.id);
      if (!userId) {
        res.status(400).json({ detail: '用户参数无效' });
        return;
      }
      try {
        const logs = await prisma.auditLog.findMany({
          where: { resource: 'user', resourceId: userId },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { id: true, action: true, details: true, createdAt: true, userId: true },
        });
        res.json({ items: logs });
      } catch {
        res.status(500).json({ detail: '获取审计记录失败' });
      }
    },
  );

  // ===== General edit (company/phone/department/bio/role/mustChangePassword/disabled) =====
  router.put('/api/admin/users/:id', authMiddleware, requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
    const userId = routeParam(req.params.id);
    if (!userId) {
      res.status(400).json({ detail: '用户参数无效' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const actorId = req.user!.userId;

    const data: Prisma.UserUpdateInput = {};
    for (const field of USER_EDITABLE_TEXT_FIELDS) {
      if (body[field] !== undefined) {
        data[field] = body[field] === null ? null : String(body[field]).slice(0, 500);
      }
    }
    if (typeof body.mustChangePassword === 'boolean') data.mustChangePassword = body.mustChangePassword;
    if (typeof body.canInvite === 'boolean') data.canInvite = body.canInvite;

    const wantRole = USER_ROLES.includes(body.role as UserRole) ? (body.role as UserRole) : undefined;
    const wantDisabled = typeof body.disabled === 'boolean' ? body.disabled : undefined;

    let roleOrDisableChanged = false;
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true, disabled: true },
        });
        if (!current) throw fail('P2025', 'NOT_FOUND');

        if (wantRole && wantRole !== current.role) {
          if (userId === actorId) throw fail('SELF', 'SELF');
          if (await wouldLoseLastActiveAdmin(tx, userId, wantRole === 'ADMIN')) throw fail('LAST_ADMIN', 'LAST_ADMIN');
          data.role = wantRole;
          roleOrDisableChanged = true;
        }
        if (wantDisabled !== undefined && wantDisabled !== current.disabled) {
          if (userId === actorId) throw fail('SELF', 'SELF');
          if (wantDisabled && (await wouldLoseLastActiveAdmin(tx, userId, false))) {
            throw fail('LAST_ADMIN', 'LAST_ADMIN');
          }
          data.disabled = wantDisabled;
          roleOrDisableChanged = true;
        }

        if (Object.keys(data).length === 0) {
          throw fail('NO_CHANGE', 'NO_CHANGE');
        }

        return tx.user.update({
          where: { id: userId },
          data,
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            company: true,
            phone: true,
            department: true,
            bio: true,
            disabled: true,
            mustChangePassword: true,
            canInvite: true,
            lastLoginAt: true,
            createdAt: true,
          },
        });
      });

      if (roleOrDisableChanged) {
        await revokeAllTokensBefore(userId, nowSeconds()).catch(() => {});
      }
      res.json({ data: updated });
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === 'P2025') {
        res.status(404).json({ detail: '用户不存在' });
        return;
      }
      if (code === 'SELF') {
        res.status(400).json({ detail: '不能对自己执行该操作' });
        return;
      }
      if (code === 'LAST_ADMIN') {
        res.status(400).json({ detail: '不能移除最后一个在用管理员' });
        return;
      }
      if (code === 'NO_CHANGE') {
        res.status(400).json({ detail: '没有需要更新的字段' });
        return;
      }
      res.status(500).json({ detail: '更新用户失败' });
    }
  });

  // ===== Update role (inline select 兼容入口) =====
  router.put(
    '/api/admin/users/:id/role',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const { role } = req.body;
      const userId = routeParam(req.params.id);
      if (!userId) {
        res.status(400).json({ detail: '用户参数无效' });
        return;
      }
      if (!USER_ROLES.includes(role as UserRole)) {
        res.status(400).json({ detail: '无效的角色' });
        return;
      }
      if (userId === req.user!.userId && role !== 'ADMIN') {
        res.status(400).json({ detail: '不能修改自己的角色' });
        return;
      }
      try {
        const user = await prisma.$transaction(async (tx) => {
          const current = await tx.user.findUnique({ where: { id: userId }, select: { role: true, disabled: true } });
          if (!current) throw fail('P2025', 'NOT_FOUND');
          if (current.role === 'ADMIN' && role !== 'ADMIN') {
            const adminCount = await tx.user.count({ where: { role: 'ADMIN', disabled: false } });
            if (adminCount <= 1) throw fail('LAST_ADMIN', 'LAST_ADMIN');
          }
          return tx.user.update({
            where: { id: userId },
            data: { role },
            select: { id: true, username: true, email: true, role: true },
          });
        });
        await revokeAllTokensBefore(userId, nowSeconds());
        res.json({ data: user });
      } catch (err: unknown) {
        const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
        if (code === 'P2025') {
          res.status(404).json({ detail: '用户不存在' });
          return;
        }
        if (code === 'LAST_ADMIN') {
          res.status(400).json({ detail: '不能移除最后一个管理员' });
          return;
        }
        res.status(500).json({ detail: '修改角色失败' });
      }
    },
  );

  // ===== Reset password (set temp password) =====
  router.post(
    '/api/admin/users/:id/reset-password',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const userId = routeParam(req.params.id);
      if (!userId) {
        res.status(400).json({ detail: '用户参数无效' });
        return;
      }
      const { password } = (req.body ?? {}) as { password?: unknown };
      if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
        res.status(400).json({ detail: `密码至少 ${PASSWORD_MIN_LENGTH} 位` });
        return;
      }
      try {
        const passwordHash = await hashPassword(password);
        await prisma.user.update({
          where: { id: userId },
          data: { passwordHash, mustChangePassword: true },
        });
        await revokeAllTokensBefore(userId, nowSeconds());
        res.json({ ok: true });
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'P2025') {
          res.status(404).json({ detail: '用户不存在' });
          return;
        }
        res.status(500).json({ detail: '重置密码失败' });
      }
    },
  );

  // ===== Send reset email =====
  router.post(
    '/api/admin/users/:id/send-reset-email',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const userId = routeParam(req.params.id);
      if (!userId) {
        res.status(400).json({ detail: '用户参数无效' });
        return;
      }
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true },
        });
        if (!user) {
          res.status(404).json({ detail: '用户不存在' });
          return;
        }
        const token = randomBytes(32).toString('hex');
        await storePasswordResetToken(token, user.id, RESET_TOKEN_TTL_SECONDS);
        await sendPasswordResetEmail(user.email, token, requestSiteUrl(req));
        res.json({ ok: true });
      } catch {
        res.status(500).json({ detail: '发送重置邮件失败' });
      }
    },
  );

  // ===== Batch (role / disable / enable) =====
  router.post(
    '/api/admin/users/batch',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const actorId = req.user!.userId;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const ids = parseIds(body.ids);
      const action = body.action;
      if (!ids.length) {
        res.status(400).json({ detail: '请选择用户' });
        return;
      }
      if (action !== 'role' && action !== 'disable' && action !== 'enable') {
        res.status(400).json({ detail: '无效的操作' });
        return;
      }
      const role = action === 'role' ? queryRole(body.role) : undefined;
      if (action === 'role' && !role) {
        res.status(400).json({ detail: '无效的角色' });
        return;
      }

      try {
        const now = nowSeconds();
        const result = await prisma.$transaction(async (tx) => {
          const targets = await tx.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, role: true, disabled: true },
          });
          const updated: string[] = [];
          const skipped: Array<{ id: string; reason: string }> = [];
          for (const t of targets) {
            if (t.id === actorId) {
              skipped.push({ id: t.id, reason: '不能操作自己' });
              continue;
            }
            if (action === 'role' && role && role !== t.role) {
              if (await wouldLoseLastActiveAdmin(tx, t.id, role === 'ADMIN')) {
                skipped.push({ id: t.id, reason: '最后一个管理员' });
                continue;
              }
              await tx.user.update({ where: { id: t.id }, data: { role } });
              updated.push(t.id);
            } else if (action === 'disable' && !t.disabled) {
              if (await wouldLoseLastActiveAdmin(tx, t.id, false)) {
                skipped.push({ id: t.id, reason: '最后一个管理员' });
                continue;
              }
              await tx.user.update({ where: { id: t.id }, data: { disabled: true } });
              updated.push(t.id);
            } else if (action === 'enable' && t.disabled) {
              await tx.user.update({ where: { id: t.id }, data: { disabled: false } });
              updated.push(t.id);
            } else {
              skipped.push({ id: t.id, reason: '无需变更' });
            }
          }
          return { updated, skipped };
        });
        await Promise.all(result.updated.map((id) => revokeAllTokensBefore(id, now).catch(() => {})));
        res.json(result);
      } catch {
        res.status(500).json({ detail: '批量操作失败' });
      }
    },
  );

  // ===== Delete (self + last-active-admin 保护) =====
  router.delete(
    '/api/admin/users/:id',
    authMiddleware,
    requireRole('ADMIN'),
    async (req: AuthRequest, res: Response) => {
      const userId = routeParam(req.params.id);
      const actorId = req.user!.userId;
      if (!userId) {
        res.status(400).json({ detail: '用户参数无效' });
        return;
      }
      if (userId === actorId) {
        res.status(400).json({ detail: '不能删除自己' });
        return;
      }
      try {
        await prisma.$transaction(async (tx) => {
          if (await wouldLoseLastActiveAdmin(tx, userId, false)) throw fail('LAST_ADMIN', 'LAST_ADMIN');
          const exists = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
          if (!exists) throw fail('P2025', 'NOT_FOUND');
          // 防级联误删：该用户名下有模型/版本时禁止直接删除——否则 user.delete 会因 schema
          // onDelete:Cascade 连带硬删其全部模型/版本/收藏/下载/评论/分享（跨 6 表，不可逆，无回收站）。
          // 要求先在「模型管理」转移归属或先删除这些模型。
          const [modelCount, versionCount] = await Promise.all([
            tx.model.count({ where: { createdById: userId } }),
            tx.modelVersion.count({ where: { createdById: userId } }),
          ]);
          if (modelCount > 0 || versionCount > 0) throw fail('HAS_CONTENT', 'HAS_CONTENT');
          await tx.user.delete({ where: { id: userId } });
        });
        await revokeAllTokensBefore(userId, nowSeconds()).catch(() => {});
        res.json({ message: '用户已删除' });
      } catch (err: unknown) {
        const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
        if (code === 'LAST_ADMIN') {
          res.status(400).json({ detail: '不能删除最后一个在用管理员' });
          return;
        }
        if (code === 'P2025') {
          res.status(404).json({ detail: '用户不存在' });
          return;
        }
        if (code === 'HAS_CONTENT') {
          res.status(400).json({
            detail:
              '该用户名下还有模型或模型版本，直接删除会连带清空其全部模型/版本/收藏/下载/评论/分享（不可逆）。请先在「模型管理」将这些模型的归属转移给其他用户，或先删除这些模型，再删除该用户。',
          });
          return;
        }
        res.status(500).json({ detail: '删除用户失败' });
      }
    },
  );

  return router;
}
