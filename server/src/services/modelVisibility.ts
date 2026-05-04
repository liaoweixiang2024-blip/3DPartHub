import { Prisma } from '@prisma/client';

type PrismaLike = {
  modelGroup: {
    findMany: (args: { select: { primaryId: true } }) => Promise<Array<{ primaryId: string | null }>>;
  };
};

/**
 * 首页“合并显示”口径：未合并模型按 1 个，已合并模型组只统计主模型 1 个。
 * 组内其他模型仅作为变体数量展示，不计入首页/分类总数。
 */
export function groupedVisibleModelSql() {
  return Prisma.sql`
    (
      group_id IS NULL
      OR id IN (
        SELECT primary_id
        FROM model_groups
        WHERE primary_id IS NOT NULL
      )
    )
  `;
}

export async function groupedVisibleModelWhere(prisma: PrismaLike) {
  const groups = await prisma.modelGroup.findMany({ select: { primaryId: true } });
  const primaryIds = groups.map((group) => group.primaryId).filter((id): id is string => Boolean(id));
  return {
    OR: [{ groupId: null }, ...(primaryIds.length > 0 ? [{ id: { in: primaryIds } }] : [])],
  };
}
