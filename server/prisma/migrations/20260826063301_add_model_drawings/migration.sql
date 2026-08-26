-- CreateTable
CREATE TABLE "model_drawings" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_drawings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "model_drawings_model_id_idx" ON "model_drawings"("model_id");

-- AddForeignKey
ALTER TABLE "model_drawings" ADD CONSTRAINT "model_drawings_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: legacy single-drawing columns -> one row per model (legacy files stay at static/drawings/{modelId}.pdf)
INSERT INTO "model_drawings" ("id", "model_id", "file_key", "name", "size", "created_at")
SELECT gen_random_uuid()::text, "id", "drawing_url", COALESCE("drawing_name", "drawing_url"), "drawing_size", "created_at"
FROM "models"
WHERE "drawing_url" IS NOT NULL;

-- Clear legacy columns (kept in schema for old module-backup restore compatibility)
UPDATE "models"
SET "drawing_url" = NULL, "drawing_name" = NULL, "drawing_size" = NULL
WHERE "drawing_url" IS NOT NULL;
