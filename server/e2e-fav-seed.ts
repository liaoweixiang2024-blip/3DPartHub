import { PrismaClient } from '@prisma/client';
import { hashPassword } from './src/lib/password.js';
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.upsert({
    where: { username: 'e2e-profile-user' },
    update: { passwordHash: await hashPassword('E2eTest#2026'), disabled: false },
    create: {
      username: 'e2e-profile-user',
      email: 'e2e-profile-user@test.local',
      passwordHash: await hashPassword('E2eTest#2026'),
      role: 'VIEWER',
    },
  });
  const models = await prisma.model.findMany({ select: { id: true }, take: 3 });
  for (const m of models) {
    await prisma.favorite.upsert({
      where: { userId_modelId: { userId: user.id, modelId: m.id } },
      update: {},
      create: { userId: user.id, modelId: m.id },
    });
  }
  const count = await prisma.favorite.count({ where: { userId: user.id } });
  console.log(JSON.stringify({ favorites: count }));
}
main().finally(() => prisma.$disconnect());
