-- CreateTable
CREATE TABLE IF NOT EXISTS "ChallengeReminder" (
    "id" TEXT NOT NULL,
    "userChallengeId" TEXT NOT NULL,
    "dueWindowKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PUSH',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChallengeReminder_userChallengeId_dueWindowKey_channel_key" ON "ChallengeReminder"("userChallengeId", "dueWindowKey", "channel");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChallengeReminder_userChallengeId_idx" ON "ChallengeReminder"("userChallengeId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChallengeReminder_userChallengeId_fkey'
  ) THEN
    ALTER TABLE "ChallengeReminder" ADD CONSTRAINT "ChallengeReminder_userChallengeId_fkey"
      FOREIGN KEY ("userChallengeId") REFERENCES "UserChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
