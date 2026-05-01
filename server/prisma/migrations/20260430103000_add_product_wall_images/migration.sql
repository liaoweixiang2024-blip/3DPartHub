CREATE TABLE IF NOT EXISTS "product_wall_images" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT '公司产品',
  "image_url" TEXT NOT NULL,
  "preview_image_url" TEXT,
  "ratio" TEXT NOT NULL DEFAULT '4 / 5',
  "tags" JSONB,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "uploader_id" TEXT,
  "uploader_name" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "reviewed_by_id" TEXT,
  "reject_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_wall_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_wall_images_status_idx" ON "product_wall_images"("status");
CREATE INDEX IF NOT EXISTS "product_wall_images_kind_idx" ON "product_wall_images"("kind");
CREATE INDEX IF NOT EXISTS "product_wall_images_sort_order_idx" ON "product_wall_images"("sort_order");
CREATE INDEX IF NOT EXISTS "product_wall_images_created_at_idx" ON "product_wall_images"("created_at");
CREATE INDEX IF NOT EXISTS "product_wall_images_uploader_id_idx" ON "product_wall_images"("uploader_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_wall_images_uploader_id_fkey') THEN
    ALTER TABLE "product_wall_images"
      ADD CONSTRAINT "product_wall_images_uploader_id_fkey"
      FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_wall_images_reviewed_by_id_fkey') THEN
    ALTER TABLE "product_wall_images"
      ADD CONSTRAINT "product_wall_images_reviewed_by_id_fkey"
      FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
