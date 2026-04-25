-- CreateTable: selection_categories
CREATE TABLE "selection_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "columns" JSONB NOT NULL,
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "selection_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "selection_categories_slug_key" ON "selection_categories"("slug");

-- CreateTable: selection_products
CREATE TABLE "selection_products" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model_no" TEXT,
    "specs" JSONB NOT NULL,
    "image" TEXT,
    "pdf_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "components" JSONB,
    "is_kit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "selection_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "selection_products_category_id_idx" ON "selection_products"("category_id");
CREATE INDEX "selection_products_model_no_idx" ON "selection_products"("model_no");

-- AddForeignKey
ALTER TABLE "selection_products" ADD CONSTRAINT "selection_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "selection_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
