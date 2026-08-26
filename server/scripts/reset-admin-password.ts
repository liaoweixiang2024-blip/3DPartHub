/**
 * 管理员密码重置脚本（本地/服务器通用）。
 * 用法：npx tsx scripts/reset-admin-password.ts <邮箱> <新密码>
 * 行为与后台「管理员重置用户密码」完全一致：bcrypt 哈希 + mustChangePassword=true
 * （首次登录强制改密）+ 作废该用户所有令牌 + 清认证缓存。
 */
process.env.DATABASE_URL ||= 'postgresql://modeluser:modelpass@localhost:5433/3dparthub';
const [email, newPassword] = process.argv.slice(2);
if (!email || !newPassword) {
  console.error('用法: npx tsx scripts/reset-admin-password.ts <邮箱> <新密码>');
  console.error('示例: npx tsx scripts/reset-admin-password.ts admin@model.com NewPass@2026');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error('新密码至少 8 位（与站点密码策略一致）');
  process.exit(1);
}

const { prisma } = await import('../src/lib/prisma.js');
const { hashPassword } = await import('../src/lib/password.js');
const { revokeAllTokensBefore } = await import('../src/lib/jwt.js');
const { cacheDel } = await import('../src/lib/cache.js');

try {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    console.error(`✖ 未找到邮箱为 ${email} 的用户`);
    process.exit(1);
  }
  if (user.role !== 'ADMIN') {
    console.warn(`⚠ 该用户角色是 ${user.role}（不是 ADMIN），仍继续重置`);
  }

  const hash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hash, mustChangePassword: true },
  });
  // 与后台一致：作废旧令牌（顶下线）+ 清缓存
  await revokeAllTokensBefore(user.id, Math.floor(Date.now() / 1000) + 1);
  await cacheDel(`auth:user:${user.id}`).catch(() => {});

  console.log(`✔ 已重置 ${user.username}（${user.email}）的密码`);
  console.log('  - 该用户所有已登录会话已被强制下线');
  console.log('  - 首次登录会要求修改密码（必须改成新值才能进入）');
  console.log('  - 现在可用新密码登录');
} finally {
  await prisma.$disconnect();
}
