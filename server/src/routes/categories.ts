import { Router } from "express";
import { createAdminCategoriesRouter } from "./categories/admin.js";
import { createPublicCategoriesRouter } from "./categories/public.js";

const router = Router();

router.use(createPublicCategoriesRouter());
router.use(createAdminCategoriesRouter());

export default router;
