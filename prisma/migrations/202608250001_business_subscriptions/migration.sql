CREATE TYPE "SubscriptionInterval" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED');

ALTER TABLE "businesses"
ADD COLUMN "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "subscriptionInterval" "SubscriptionInterval",
ADD COLUMN "subscriptionExpiresAt" TIMESTAMP(3);

CREATE TABLE "subscription_payments" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "interval" "SubscriptionInterval" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "transactionId" TEXT NOT NULL,
  "receiptCode" TEXT,
  "receiptInput" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_payments_transactionId_key"
ON "subscription_payments"("transactionId");
CREATE INDEX "subscription_payments_businessId_createdAt_idx"
ON "subscription_payments"("businessId", "createdAt");
ALTER TABLE "subscription_payments"
ADD CONSTRAINT "subscription_payments_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "businesses"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
