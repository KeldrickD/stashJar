-- AlterEnum
ALTER TYPE "EntryType" ADD VALUE 'TREASURY_FUNDED';

-- CreateTable
CREATE TABLE "YieldRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalYieldCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "metadata" JSONB,

    CONSTRAINT "YieldRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YieldAllocation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "yieldRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userStashAccountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "YieldAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YieldRun_runKey_key" ON "YieldRun"("runKey");

-- CreateIndex
CREATE UNIQUE INDEX "YieldAllocation_idempotencyKey_key" ON "YieldAllocation"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "YieldAllocation" ADD CONSTRAINT "YieldAllocation_yieldRunId_fkey" FOREIGN KEY ("yieldRunId") REFERENCES "YieldRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YieldAllocation" ADD CONSTRAINT "YieldAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
