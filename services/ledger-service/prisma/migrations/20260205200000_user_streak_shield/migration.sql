-- POWER: streak shield (1 active at a time; when used, needs 2 saves in next window to preserve streak)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "streakShieldAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "streakShieldUsedAtUtc" TEXT;
