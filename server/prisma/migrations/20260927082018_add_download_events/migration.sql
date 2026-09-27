-- CreateTable
CREATE TABLE "download_events" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "user_id" TEXT,
    "format" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'model',
    "share_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "download_events_created_at_idx" ON "download_events"("created_at");

-- CreateIndex
CREATE INDEX "download_events_model_id_created_at_idx" ON "download_events"("model_id", "created_at");

-- CreateIndex
CREATE INDEX "download_events_user_id_created_at_idx" ON "download_events"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: 把既有登录用户下载历史回填为事件，保留原始时间，趋势图历史不空白
INSERT INTO "download_events" ("id", "model_id", "user_id", "format", "file_size", "source", "created_at")
SELECT gen_random_uuid(), "model_id", "user_id", "format", "file_size", 'model', "created_at" FROM "downloads";
