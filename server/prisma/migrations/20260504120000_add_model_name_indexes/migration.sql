CREATE INDEX IF NOT EXISTS "models_name_idx" ON "models"("name");
CREATE INDEX IF NOT EXISTS "models_name_status_idx" ON "models"("name", "status");
