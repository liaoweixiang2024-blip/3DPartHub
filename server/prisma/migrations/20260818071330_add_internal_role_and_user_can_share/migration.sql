-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'INTERNAL';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "can_share" BOOLEAN NOT NULL DEFAULT false;
