-- CreateIndex (composite indexes for common query patterns)
CREATE INDEX IF NOT EXISTS "models_status_created_at_idx" ON "models"("status", "created_at");
CREATE INDEX IF NOT EXISTS "models_status_category_id_created_at_idx" ON "models"("status", "category_id", "created_at");
CREATE INDEX IF NOT EXISTS "comments_model_id_created_at_idx" ON "comments"("model_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "model_versions_model_id_idx" ON "model_versions"("model_id");
