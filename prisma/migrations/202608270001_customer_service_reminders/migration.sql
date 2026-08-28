ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CUSTOMER_REMINDER';

CREATE TYPE "CustomerNotePriority" AS ENUM ('INFO', 'IMPORTANT', 'DANGER');

ALTER TABLE "customers"
ADD COLUMN "serviceIntervalDays" INTEGER,
ADD COLUMN "nextServiceReminderAt" TIMESTAMP(3),
ADD COLUMN "lastServiceReminderSentAt" TIMESTAMP(3);

CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "priority" "CustomerNotePriority" NOT NULL DEFAULT 'INFO',
    "icon" TEXT NOT NULL DEFAULT 'NOTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_notes_customerId_createdAt_idx" ON "customer_notes"("customerId", "createdAt");
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
