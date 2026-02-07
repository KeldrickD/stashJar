-- AlterTable UserWallet: walletType, chain, accountedPrincipalUsdcMicros for funding/refresh
ALTER TABLE "UserWallet" ADD COLUMN IF NOT EXISTS "walletType" TEXT NOT NULL DEFAULT 'SMART';
ALTER TABLE "UserWallet" ADD COLUMN IF NOT EXISTS "chain" TEXT NOT NULL DEFAULT 'base';
ALTER TABLE "UserWallet" ADD COLUMN IF NOT EXISTS "accountedPrincipalUsdcMicros" TEXT NOT NULL DEFAULT '0';
