import { Router } from "express";
import { createAdminSharesRouter } from "./shares/adminShares.js";
import { createPublicSharesRouter } from "./shares/publicShares.js";
import { createUserSharesRouter } from "./shares/userShares.js";

const router = Router();

router.use(createUserSharesRouter());
router.use(createAdminSharesRouter());
router.use(createPublicSharesRouter());

export default router;
