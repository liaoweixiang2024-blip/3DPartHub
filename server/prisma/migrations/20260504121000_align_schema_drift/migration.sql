ALTER TABLE "inquiry_items" ADD COLUMN IF NOT EXISTS "unit" TEXT DEFAULT '个';
ALTER TABLE "selection_products" ADD COLUMN IF NOT EXISTS "unit" TEXT DEFAULT '个';

ALTER TABLE "product_wall_categories" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "product_wall_images" ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "product_wall_images"
  ALTER COLUMN "kind" TYPE VARCHAR(50),
  ALTER COLUMN "ratio" TYPE VARCHAR(20),
  ALTER COLUMN "status" TYPE VARCHAR(20);

DROP INDEX IF EXISTS "product_wall_images_tags_idx";

DO $$
BEGIN
  IF to_regclass('public."product_wall_image_favorites_userId_imageId_key"') IS NOT NULL
     AND to_regclass('public."product_wall_image_favorites_user_id_image_id_key"') IS NULL THEN
    ALTER INDEX "product_wall_image_favorites_userId_imageId_key"
      RENAME TO "product_wall_image_favorites_user_id_image_id_key";
  END IF;

  IF to_regclass('public."product_wall_image_favorites_userId_idx"') IS NOT NULL
     AND to_regclass('public."product_wall_image_favorites_user_id_idx"') IS NULL THEN
    ALTER INDEX "product_wall_image_favorites_userId_idx"
      RENAME TO "product_wall_image_favorites_user_id_idx";
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "product_wall_images_status_kind_sort_order_idx"
  ON "product_wall_images"("status", "kind", "sort_order");
