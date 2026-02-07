-- UserWallet: providerRef, lastFundingRefreshAt, lastObservedBalanceMicros
ALTER TABLE "UserWallet" ADD COLUMN IF NOT EXISTS "providerRef" TEXT;
ALTER TABLE "UserWallet" ADD COLUMN IF NOT EXISTS "lastFundingRefreshAt" TIMESTAMP(3);
ALTER TABLE "UserWallet" ADD COLUMN IF NOT EXISTS "lastObservedBalanceMicros" TEXT;
