import { createLogger } from '../lib/logger.js';

const log = createLogger({ component: 'model-drawings' });

/**
 * 旧单图纸列（models.drawing_url/drawing_name/drawing_size）→ model_drawings 行的幂等回填。
 *
 * 场景：恢复一个旧的全量备份（database.sql 里 models 行仍带 drawing_url 值）。恢复流程会先
 * 跑 prisma migrate deploy，但 add_model_drawings 迁移已应用过不会重跑，其回填段落因此被跳过。
 * 这里在启动与恢复完成后各调一次：有 legacy 值且该模型尚无新行的补一行，然后清空旧列。
 */
export async function reconcileLegacyModelDrawings(prisma: {
  $executeRawUnsafe: (query: string) => Promise<number>;
}): Promise<number> {
  try {
    const inserted = await prisma.$executeRawUnsafe(`
      INSERT INTO "model_drawings" ("id", "model_id", "file_key", "name", "size", "created_at")
      SELECT gen_random_uuid()::text, m."id", m."drawing_url",
             COALESCE(m."drawing_name", m."drawing_url"), m."drawing_size", m."created_at"
      FROM "models" m
      WHERE m."drawing_url" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "model_drawings" d WHERE d."model_id" = m."id")
    `);
    if (inserted > 0) {
      await prisma.$executeRawUnsafe(`
        UPDATE "models"
        SET "drawing_url" = NULL, "drawing_name" = NULL, "drawing_size" = NULL
        WHERE "drawing_url" IS NOT NULL
      `);
      log.info(`Reconciled ${inserted} legacy model drawing(s) into model_drawings`);
    }
    return inserted;
  } catch (err) {
    // 兜底任务失败不阻断启动/恢复主流程（表可能尚不存在于极老备份恢复路径中）
    log.warn({ err }, 'Failed to reconcile legacy model drawings');
    return 0;
  }
}
