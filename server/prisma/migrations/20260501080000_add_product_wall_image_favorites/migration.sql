-- CreateTable
CREATE TABLE "product_wall_image_favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "image_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_wall_image_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_wall_image_favorites_userId_imageId_key" ON "product_wall_image_favorites"("user_id", "image_id");

-- CreateIndex
CREATE INDEX "product_wall_image_favorites_userId_idx" ON "product_wall_image_favorites"("user_id");

-- AddForeignKey
ALTER TABLE "product_wall_image_favorites" ADD CONSTRAINT "product_wall_image_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_wall_image_favorites" ADD CONSTRAINT "product_wall_image_favorites_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "product_wall_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
