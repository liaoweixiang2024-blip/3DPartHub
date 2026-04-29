import { Router } from "express";
import { createSelectionAdminCategoriesRouter } from "./selections/adminCategories.js";
import { createSelectionAdminProductsRouter } from "./selections/adminProducts.js";
import { createSelectionOptionImagesRouter } from "./selections/optionImages.js";
import { createSelectionPublicRouter } from "./selections/public.js";

const router = Router();

router.use(createSelectionPublicRouter());
router.use(createSelectionAdminCategoriesRouter());
router.use(createSelectionAdminProductsRouter());
router.use(createSelectionOptionImagesRouter());

export default router;
