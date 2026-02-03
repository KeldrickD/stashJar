-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('NORMIE', 'CURIOUS', 'POWER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tier" "UserTier" NOT NULL DEFAULT 'NORMIE';

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TierPolicy" (
    "id" TEXT NOT NULL,
    "tier" "UserTier" NOT NULL,
    "flagKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TierPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFlagOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "UserFlagOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TierPolicy_tier_flagKey_key" ON "TierPolicy"("tier", "flagKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserFlagOverride_userId_flagKey_key" ON "UserFlagOverride"("userId", "flagKey");

-- AddForeignKey
ALTER TABLE "TierPolicy" ADD CONSTRAINT "TierPolicy_flagKey_fkey" FOREIGN KEY ("flagKey") REFERENCES "FeatureFlag"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFlagOverride" ADD CONSTRAINT "UserFlagOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFlagOverride" ADD CONSTRAINT "UserFlagOverride_flagKey_fkey" FOREIGN KEY ("flagKey") REFERENCES "FeatureFlag"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
