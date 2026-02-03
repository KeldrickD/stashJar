-- AlterTable
ALTER TABLE "VaultPosition" ADD COLUMN     "currentValueUsdcMicros" TEXT,
ADD COLUMN     "lastMarkedAt" TIMESTAMP(3);
