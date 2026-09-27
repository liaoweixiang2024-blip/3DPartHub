-- AlterTable
ALTER TABLE "selection_categories" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "selection_products" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;
