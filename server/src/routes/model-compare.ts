import { Router, Request, Response } from "express";
import { compareModels } from "../services/comparison.js";
import { optionalString } from "../lib/requestValidation.js";
import { requireBrowseAccess } from "../middleware/browseAccess.js";

const router = Router();

router.get("/api/models/compare", async (req: Request, res: Response) => {
  if (!(await requireBrowseAccess(req, res))) return;

  const id1 = optionalString(req.query.id1, { maxLength: 80 });
  const id2 = optionalString(req.query.id2, { maxLength: 80 });
  if (!id1 || !id2) {
    res.status(400).json({ detail: "需要 id1 和 id2 参数" });
    return;
  }
  try {
    const result = await compareModels(id1, id2);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ detail: err.message || "对比失败" });
  }
});

export default router;
