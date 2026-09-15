-- AlterTable
ALTER TABLE "product_wall_images" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "product_wall_images_deleted_at_idx" ON "product_wall_images"("deleted_at");
