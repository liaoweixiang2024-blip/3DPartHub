-- DropForeignKey
ALTER TABLE "model_versions" DROP CONSTRAINT IF EXISTS "model_versions_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "models" DROP CONSTRAINT IF EXISTS "models_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_owner_id_fkey";

-- DropForeignKey
ALTER TABLE "share_links" DROP CONSTRAINT IF EXISTS "share_links_created_by_id_fkey";

-- Clean up orphaned rows before adding foreign keys.
-- Early versions had no CASCADE, so deleting a user left child records pointing to nowhere.
-- Reassign to the first admin so no data is lost; fall back to deletion only if no admin exists.
DO $$ DECLARE admin_id TEXT; BEGIN
  SELECT id INTO admin_id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1;
  IF admin_id IS NOT NULL THEN
    UPDATE models SET created_by_id = admin_id WHERE created_by_id NOT IN (SELECT id FROM users);
    UPDATE model_versions SET created_by_id = admin_id WHERE created_by_id NOT IN (SELECT id FROM users);
    UPDATE share_links SET created_by_id = admin_id WHERE created_by_id NOT IN (SELECT id FROM users);
    UPDATE projects SET owner_id = admin_id WHERE owner_id NOT IN (SELECT id FROM users);
  ELSE
    DELETE FROM models WHERE created_by_id NOT IN (SELECT id FROM users);
    DELETE FROM model_versions WHERE created_by_id NOT IN (SELECT id FROM users);
    DELETE FROM share_links WHERE created_by_id NOT IN (SELECT id FROM users);
    DELETE FROM projects WHERE owner_id NOT IN (SELECT id FROM users);
  END IF;
END $$;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
