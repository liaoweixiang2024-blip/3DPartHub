-- CreateTable
CREATE TABLE "model_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "primary_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_groups_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "models" ADD COLUMN "group_id" TEXT;
ALTER TABLE "models" ADD COLUMN "drawing_url" TEXT;

-- CreateIndex
CREATE INDEX "models_group_id_idx" ON "models"("group_id");

-- AddForeignKey
ALTER TABLE "model_groups" ADD CONSTRAINT "model_groups_primary_id_fkey" FOREIGN KEY ("primary_id") REFERENCES "models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "models" ADD CONSTRAINT "models_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "model_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "model_groups_primary_id_key" ON "model_groups"("primary_id");
