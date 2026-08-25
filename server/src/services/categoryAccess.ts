import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { prisma } from '../lib/prisma.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getVerifiedRequestUser, verifyRequestToken } from '../middleware/auth.js';

export type CategoryAccessContext = {
  role: string | null;
  userId: string | null;
};

/**
 * 从请求解析查看者身份（可选登录场景）：
 * 优先用中间件已挂好的 (req as AuthRequest).user（authMiddleware / requireBrowseAccess 登录态），
 * 否则用 getVerifiedRequestUser 按令牌查库解析（require_login_browse=false 时中间件不挂 user）。
 *
 * 注意：不能直接信任 JWT payload 里的 role——那是签发时烧进去的快照（7 天有效），
 * 管理员改角色后旧 token 仍带着旧角色，会把被降级用户当作原角色放行。
 * getVerifiedRequestUser 会查 token 作废名单（改角色时会 revokeAllTokensBefore）并回读数据库角色。
 */
export async function getViewerContext(req: Request): Promise<CategoryAccessContext> {
  const attached = (req as AuthRequest).user;
  if (attached?.role) {
    return { role: attached.role, userId: attached.userId ?? null };
  }
  if (!verifyRequestToken(req)) return { role: null, userId: null };
  try {
    const verified = await getVerifiedRequestUser(req);
    if (verified?.payload.role) {
      return { role: verified.payload.role, userId: verified.payload.userId ?? null };
    }
  } catch {
    // 认证服务异常时按匿名处理（不可见集合更大，安全侧兜底）
  }
  return { role: null, userId: null };
}

/**
 * 分类级访问控制：返回该查看者**不可见**的分类 id 集合。
 * - ADMIN → 空 Set
 * - restricted 且白名单（allowedRoles 勾中的角色 ∪ allowedUserIds 指定用户）不含查看者 → 直接不可见
 * - 不可见性沿树向下传播：受限分类的子孙分类（即使自身公开）一并不可见
 *
 * 分类表极小（几十行），每请求直查，权限修改即时生效，不做缓存。
 */
export async function getInvisibleCategoryIds(role: string | null, userId: string | null): Promise<Set<string>> {
  if (role === 'ADMIN') return new Set();

  const categories = await prisma.category.findMany({
    select: { id: true, parentId: true, restricted: true, allowedRoles: true, allowedUserIds: true },
  });

  const invisible = new Set<string>();
  const childrenOf = new Map<string, string[]>();
  for (const cat of categories) {
    if (cat.restricted && !cat.allowedRoles.includes(role ?? '') && !cat.allowedUserIds.includes(userId ?? '')) {
      invisible.add(cat.id);
    }
    if (cat.parentId) {
      const list = childrenOf.get(cat.parentId);
      if (list) list.push(cat.id);
      else childrenOf.set(cat.parentId, [cat.id]);
    }
  }

  // 传播：受限节点的子孙一律不可见（BFS）
  const queue = [...invisible];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const childId of childrenOf.get(current) ?? []) {
      if (!invisible.has(childId)) {
        invisible.add(childId);
        queue.push(childId);
      }
    }
  }

  return invisible;
}

/** 便捷封装：请求 → 不可见分类集合 */
export async function getInvisibleCategoryIdsForRequest(req: Request): Promise<Set<string>> {
  const { role, userId } = await getViewerContext(req);
  return getInvisibleCategoryIds(role, userId);
}

/**
 * 权限桶 key：空集合 → ''（匿名/ADMIN/无受限分类时复用原缓存 key，命中行为不变）；
 * 否则用排序后 id 集合的哈希前缀，相同可见性的用户共享同一份缓存。
 */
export function accessBucketKey(invisible: Set<string>): string {
  if (invisible.size === 0) return '';
  const hash = createHash('sha1')
    .update([...invisible].sort().join(','))
    .digest('hex');
  return hash.slice(0, 12);
}

/** 排除受限分类模型的 where 片段。注意：不能裸写 categoryId notIn —— 那会把未分类（NULL）模型一并过滤掉。 */
export function excludedCategoriesWhere(invisible: Set<string>) {
  const ids = [...invisible];
  if (ids.length === 0) return undefined;
  return { OR: [{ categoryId: null }, { categoryId: { notIn: ids } }] };
}
