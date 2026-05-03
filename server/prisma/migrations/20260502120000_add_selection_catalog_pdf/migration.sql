-- AlterTable
ALTER TABLE "selection_categories" ADD COLUMN "catalog_pdf" TEXT;
ALTER TABLE "selection_categories" ADD COLUMN "catalog_shared" BOOLEAN NOT NULL DEFAULT false;
