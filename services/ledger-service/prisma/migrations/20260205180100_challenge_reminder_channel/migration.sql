-- Add channel column (PUSH | EMAIL) and extend unique to (userChallengeId, dueWindowKey, channel)
ALTER TABLE "ChallengeReminder" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'PUSH';

DROP INDEX IF EXISTS "ChallengeReminder_userChallengeId_dueWindowKey_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ChallengeReminder_userChallengeId_dueWindowKey_channel_key"
  ON "ChallengeReminder"("userChallengeId", "dueWindowKey", "channel");
