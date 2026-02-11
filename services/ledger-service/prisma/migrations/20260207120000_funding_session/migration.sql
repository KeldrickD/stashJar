-- CreateTable
CREATE TABLE "FundingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'coinbase',
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingSession_userId_createdAt_idx" ON "FundingSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FundingSession_createdAt_idx" ON "FundingSession"("createdAt");

-- AddForeignKey
ALTER TABLE "FundingSession" ADD CONSTRAINT "FundingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
