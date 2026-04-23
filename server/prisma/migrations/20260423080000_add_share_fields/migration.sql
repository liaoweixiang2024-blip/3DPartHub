-- AlterTable: add share control fields
ALTER TABLE "share_links" ADD COLUMN "allow_preview" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "share_links" ADD COLUMN "allow_download" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "share_links" ADD COLUMN "download_limit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "share_links" ADD COLUMN "download_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "share_links" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;
