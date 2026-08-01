import { Router, Response } from 'express';
import { generateInviteCode } from '../lib/inviteCode.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { featureGuard } from '../middleware/featureToggle.js';

const router = Router();

const inviteSelect = {
  id: true,
  code: true,
  note: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  usedAt: true,
  usedBy: { select: { id: true, username: true } },
} as const;

/**
 * canInvite 不在 JWT payload 里（token 只含 userId/role），按 userId 实时查 DB。
 * 这样管理员开启权限后立即生效，无需用户重新登录。
 */
async function userCanInvite(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { canInvite: true } });
  return u?.canInvite === true;
}

type ParsedExpires = { ok: true; expiresAt: Date | null } | { ok: false; error: string };

function parseExpiresAt(value: unknown): ParsedExpires {
  if (value === undefined || value === null || value === '') return { ok: true, expiresAt: null };
  if (typeof value !== 'string') return { ok: false, error: '过期时间格式无效' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { ok: false, error: '过期时间格式无效' };
  if (d.getTime() <= Date.now()) return { ok: false, error: '过期时间必须晚于当前时间' };
  return { ok: true, expiresAt: d };
}

// 列出当前用户创建的邀请码
router.get(
  '/api/invites',
  featureGuard('require_invite_code'),
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!(await userCanInvite(req.user!.userId))) {
        res.status(403).json({ detail: '没有查看邀请码的权限' });
        return;
      }
      const items = await prisma.inviteCode.findMany({
        where: { createdById: req.user!.userId },
        orderBy: { createdAt: 'desc' },
        select: inviteSelect,
      });
      res.json(items);
    } catch (err) {
      logger.error({ err }, '[invites] list failed');
      res.status(500).json({ detail: '获取邀请码失败' });
    }
  },
);

// 生成一次性邀请码
router.post(
  '/api/invites',
  featureGuard('require_invite_code'),
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!(await userCanInvite(req.user!.userId))) {
        res.status(403).json({ detail: '没有生成邀请码的权限' });
        return;
      }
      const body = (req.body ?? {}) as { note?: unknown; expiresAt?: unknown };
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null;
      const parsed = parseExpiresAt(body.expiresAt);
      if (!parsed.ok) {
        res.status(400).json({ detail: parsed.error });
        return;
      }

      // code @unique 碰撞重试（6 字节 base64url 碰撞概率极低，主动重试避免依赖异常）
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const created = await prisma.inviteCode.create({
            data: {
              code: generateInviteCode(),
              note,
              expiresAt: parsed.expiresAt,
              createdById: req.user!.userId,
              status: 'active',
            },
            select: inviteSelect,
          });
          res.status(201).json(created);
          return;
        } catch (err) {
          if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'P2002') {
            continue;
          }
          throw err;
        }
      }
      res.status(500).json({ detail: '生成邀请码失败，请重试' });
    } catch (err) {
      logger.error({ err }, '[invites] create failed');
      res.status(500).json({ detail: '生成邀请码失败' });
    }
  },
);

// 吊销邀请码（仅 active 且自己创建的；已使用的码保留审计，不可删除）
router.delete(
  '/api/invites/:id',
  featureGuard('require_invite_code'),
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!(await userCanInvite(req.user!.userId))) {
        res.status(403).json({ detail: '没有管理邀请码的权限' });
        return;
      }
      const targetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const existing = await prisma.inviteCode.findUnique({
        where: { id: targetId },
        select: { id: true, createdById: true, status: true },
      });
      if (!existing || existing.createdById !== req.user!.userId) {
        res.status(404).json({ detail: '邀请码不存在' });
        return;
      }
      if (existing.status !== 'active') {
        res.status(400).json({ detail: '该邀请码已使用或已吊销，无法删除' });
        return;
      }
      await prisma.inviteCode.delete({ where: { id: existing.id } });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, '[invites] revoke failed');
      res.status(500).json({ detail: '吊销邀请码失败' });
    }
  },
);

export default router;
