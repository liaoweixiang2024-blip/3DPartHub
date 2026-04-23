-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "comments_model_id_idx" ON "comments"("model_id");

-- CreateIndex
CREATE INDEX "downloads_user_id_idx" ON "downloads"("user_id");

-- CreateIndex
CREATE INDEX "downloads_user_id_created_at_idx" ON "downloads"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "favorites_user_id_idx" ON "favorites"("user_id");

-- CreateIndex
CREATE INDEX "models_status_idx" ON "models"("status");

-- CreateIndex
CREATE INDEX "models_category_id_idx" ON "models"("category_id");

-- CreateIndex
CREATE INDEX "models_created_by_id_idx" ON "models"("created_by_id");

-- CreateIndex
CREATE INDEX "models_created_at_idx" ON "models"("created_at");

-- CreateTable
ALTER TABLE "models" ADD COLUMN "file_modified_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "models_project_id_idx" ON "models"("project_id");
