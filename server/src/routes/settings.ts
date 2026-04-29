import { Router } from "express";
import { createSettingsAdminRouter } from "./settings/admin.js";
import { createSettingsAssetsRouter } from "./settings/assets.js";
import { createSettingsBackupRouter } from "./settings/backup.js";
import { createSettingsPublicRouter } from "./settings/public.js";

const router = Router();

router.use(createSettingsBackupRouter());
router.use(createSettingsAdminRouter());
router.use(createSettingsAssetsRouter());
router.use(createSettingsPublicRouter());

export default router;
