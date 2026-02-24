-- AlterTable
ALTER TABLE "FundingSession" ADD COLUMN "walletAddress" TEXT;
ALTER TABLE "FundingSession" ADD COLUMN "chainId" INTEGER;
ALTER TABLE "FundingSession" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "FundingSession" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "FundingSession" ADD COLUMN "ipHash" TEXT;
ALTER TABLE "FundingSession" ADD COLUMN "limitsSnapshot" JSONB;
