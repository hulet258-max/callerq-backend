CREATE TYPE "ChapaPaymentPurpose" AS ENUM ('SUBSCRIPTION', 'BOOKING');
CREATE TYPE "ChapaPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CONSUMED');
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CHAPA';

CREATE TABLE "chapa_payment_intents" (
    "id" UUID NOT NULL,
    "txRef" TEXT NOT NULL,
    "purpose" "ChapaPaymentPurpose" NOT NULL,
    "status" "ChapaPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "businessId" UUID NOT NULL,
    "ownerUserId" UUID,
    "interval" "SubscriptionInterval",
    "serviceId" UUID,
    "customerName" TEXT,
    "normalizedPhone" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "checkoutUrl" TEXT NOT NULL,
    "providerReference" TEXT,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chapa_payment_intents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chapa_payment_intents_txRef_key" ON "chapa_payment_intents"("txRef");
CREATE INDEX "chapa_payment_intents_businessId_purpose_status_idx" ON "chapa_payment_intents"("businessId", "purpose", "status");
CREATE INDEX "chapa_payment_intents_ownerUserId_purpose_status_idx" ON "chapa_payment_intents"("ownerUserId", "purpose", "status");
ALTER TABLE "chapa_payment_intents" ADD CONSTRAINT "chapa_payment_intents_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
