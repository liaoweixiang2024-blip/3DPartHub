import { Router } from 'express';
import { createCategoryRouter } from './categories.js';
import { createFavoriteRouter } from './favorites.js';
import { createItemRouter } from './items.js';

export default function productWallRouter() {
  const router = Router();

  router.use(createCategoryRouter());
  router.use(createItemRouter());
  router.use(createFavoriteRouter());

  return router;
}
