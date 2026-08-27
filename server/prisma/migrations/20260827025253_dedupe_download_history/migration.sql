/*
  Warnings:

  - A unique constraint covering the columns `[user_id,model_id,format]` on the table `downloads` will be added. If there are existing duplicate values, this will fail.

*/
-- Deduplicate existing download history first: keep only the newest row per (user_id, model_id, format).
-- Self-join delete keeps the row with the latest created_at (ties resolved by id) in each group.
DELETE FROM "downloads" d
USING "downloads" newer
WHERE d.user_id = newer.user_id
  AND d.model_id = newer.model_id
  AND d.format = newer.format
  AND (d.created_at, d.id) < (newer.created_at, newer.id);

-- CreateIndex
CREATE UNIQUE INDEX "downloads_user_model_format_key" ON "downloads"("user_id", "model_id", "format");
