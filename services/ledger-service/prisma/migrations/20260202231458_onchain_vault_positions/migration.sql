-- CreateEnum
CREATE TYPE "OnchainActionType" AS ENUM ('VAULT_DEPOSIT', 'VAULT_WITHDRAW_REQUEST', 'VAULT_REDEEM');

-- CreateEnum
CREATE TYPE "OnchainStatus" AS ENUM ('CREATED', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "UserWallet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "UserWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnchainAction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "OnchainActionType" NOT NULL,
    "status" "OnchainStatus" NOT NULL DEFAULT 'CREATED',
    "chain" TEXT NOT NULL,
    "txHash" TEXT,
    "blockNumber" INTEGER,
    "paymentIntentId" TEXT,
    "requestId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "OnchainAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultPosition" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "shares" TEXT NOT NULL,
    "totalUsdcMicros" TEXT NOT NULL,

    CONSTRAINT "VaultPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserWallet_userId_key" ON "UserWallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OnchainAction_idempotencyKey_key" ON "OnchainAction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "VaultPosition_userId_key" ON "VaultPosition"("userId");

-- AddForeignKey
ALTER TABLE "UserWallet" ADD CONSTRAINT "UserWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnchainAction" ADD CONSTRAINT "OnchainAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnchainAction" ADD CONSTRAINT "OnchainAction_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultPosition" ADD CONSTRAINT "VaultPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
