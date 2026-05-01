CREATE TABLE IF NOT EXISTS "product_wall_categories" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_wall_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_wall_categories_name_key" ON "product_wall_categories"("name");
CREATE INDEX IF NOT EXISTS "product_wall_categories_sort_order_idx" ON "product_wall_categories"("sort_order");
