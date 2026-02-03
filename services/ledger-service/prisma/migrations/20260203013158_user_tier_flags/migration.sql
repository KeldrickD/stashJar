-- AlterEnum
ALTER TYPE "UserTier" ADD VALUE 'DEV';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "flags" JSONB;
