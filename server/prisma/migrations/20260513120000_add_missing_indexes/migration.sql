-- CreateIndex
CREATE INDEX IF NOT EXISTS "comments_user_id_idx" ON "comments"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "downloads_model_id_idx" ON "downloads"("model_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "share_links_model_id_idx" ON "share_links"("model_id");
