ALTER TABLE "selection_categories" ADD COLUMN "group_id" TEXT;
ALTER TABLE "selection_categories" ADD COLUMN "group_name" TEXT;
ALTER TABLE "selection_categories" ADD COLUMN "group_icon" TEXT;
ALTER TABLE "selection_categories" ADD COLUMN "kind" TEXT DEFAULT 'product';
