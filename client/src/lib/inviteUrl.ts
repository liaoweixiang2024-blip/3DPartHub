/**
 * 构造邀请链接：${origin}/register?invite=${code}。
 * 纯函数，便于单测；origin 末尾斜杠会被去掉，code 会做 URL 编码。
 */
export function buildInviteUrl(code: string, origin: string): string {
  const base = (origin || '').replace(/\/+$/, '');
  const safeCode = encodeURIComponent(code || '');
  return `${base}/register?invite=${safeCode}`;
}
