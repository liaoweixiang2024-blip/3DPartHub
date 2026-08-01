import { randomBytes } from 'node:crypto';

/** 邀请码生命周期状态：待使用 / 已使用 / 已吊销。 */
export const INVITE_CODE_STATUSES = ['active', 'used', 'revoked'] as const;
export type InviteCodeStatus = (typeof INVITE_CODE_STATUSES)[number];

/** 校验所需的邀请码快照（从 prisma 查出的子集）。 */
export interface InviteCodeSnapshot {
  status: string;
  expiresAt: Date | null;
  /** 一次一码：被使用的那个新用户 id；未使用时为 null。 */
  usedById: string | null;
}

export type InviteInvalidReason = 'not_found' | 'expired' | 'used' | 'revoked';

export type InviteAssessment = { ok: true } | { ok: false; reason: InviteInvalidReason };

/** 校验失败原因 → 面向用户的中文提示。 */
export const INVITE_REASON_MSG: Record<InviteInvalidReason, string> = {
  not_found: '邀请码无效',
  expired: '邀请码已过期',
  used: '邀请码已被使用',
  revoked: '邀请码已吊销',
};

/**
 * 评估邀请码是否可用于注册（一次一码语义）。纯函数，无副作用，便于单测。
 * 判定顺序：不存在 → 已使用 → 已吊销 → 已过期 → 可用。
 */
export function assessInviteCode(code: InviteCodeSnapshot | null, now: Date): InviteAssessment {
  if (!code) return { ok: false, reason: 'not_found' };
  // 一次一码：已使用过的码（status=used 或已绑定 usedById）一律不可再用
  if (code.status === 'used' || code.usedById) return { ok: false, reason: 'used' };
  if (code.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (code.expiresAt && code.expiresAt.getTime() < now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

/**
 * 生成一次性邀请码：6 字节 base64url → 8 字符，URL 安全，可直接拼进邀请链接。
 */
export function generateInviteCode(): string {
  return randomBytes(6).toString('base64url');
}
