-- Drop orphaned BOM selection system tables and columns that were removed from schema.prisma
-- but still exist in the database from previously applied (and since deleted) migrations.

-- DropForeignKey
ALTER TABLE "selection_bom_media" DROP CONSTRAINT IF EXISTS "selection_bom_media_template_id_fkey";
ALTER TABLE "selection_bom_rules" DROP CONSTRAINT IF EXISTS "selection_bom_rules_template_id_fkey";
ALTER TABLE "selection_categories" DROP CONSTRAINT IF EXISTS "selection_categories_parent_id_fkey";
ALTER TABLE "selection_templates" DROP CONSTRAINT IF EXISTS "selection_templates_category_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "selection_categories_parent_id_idx";

-- AlterTable
ALTER TABLE "selection_categories" DROP COLUMN IF EXISTS "catalog_shared_field",
DROP COLUMN IF EXISTS "parent_id";

-- DropTable
DROP TABLE IF EXISTS "selection_bom_media";
DROP TABLE IF EXISTS "selection_bom_rules";
DROP TABLE IF EXISTS "selection_materials";
DROP TABLE IF EXISTS "selection_templates";
