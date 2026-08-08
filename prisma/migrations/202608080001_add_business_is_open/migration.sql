-- This field was previously added to an already-applied migration. Keep this
-- migration idempotent so databases that ran that edited migration also deploy
-- safely.
ALTER TABLE "businesses"
ADD COLUMN IF NOT EXISTS "isOpen" BOOLEAN NOT NULL DEFAULT true;
