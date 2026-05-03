-- CreateIndex
-- GIN index on tags JSONB column for @> containment queries
CREATE INDEX "product_wall_images_tags_idx" ON "product_wall_images" USING GIN ("tags");
