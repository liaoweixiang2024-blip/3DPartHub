import { Router, Request, Response } from 'express';
import { compareModels } from '../services/comparison.js';
import { optionalString } from '../lib/requestValidation.js';
import { requireBrowseAccess } from '../middleware/browseAccess.js';
import { prisma } from '../lib/prisma.js';
import { MODEL_STATUS } from '../services/modelStatus.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.get('/api/models/compare', async (req: Request, res: Response) => {
  if (!(await requireBrowseAccess(req, res))) return;

  const id1 = optionalString(req.query.id1, { maxLength: 80 });
  const id2 = optionalString(req.query.id2, { maxLength: 80 });
  if (!id1 || !id2) {
    res.status(400).json({ detail: '需要 id1 和 id2 参数' });
    return;
  }
  try {
    if (prisma) {
      const models = await prisma.model.findMany({
        where: { id: { in: [id1, id2] }, status: MODEL_STATUS.COMPLETED },
        select: { id: true },
      });
      if (models.length < 2) {
        res.status(404).json({ detail: '模型不存在或未完成转换' });
        return;
      }
    }
    const result = await compareModels(id1, id2);
    res.json(result);
  } catch (err: any) {
    logger.error({ err_message: err.message }, '[model-compare] Error');
    res.status(400).json({ detail: '对比失败' });
  }
});

export default router;
