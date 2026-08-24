-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "allowed_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "allowed_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "restricted" BOOLEAN NOT NULL DEFAULT false;
