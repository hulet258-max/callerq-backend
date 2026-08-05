-- Public booking lifecycle and scheduling metadata.
CREATE TYPE "AppointmentSource" AS ENUM ('OWNER', 'CUSTOMER_APP');

ALTER TABLE "businesses"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isApproved" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isSuspended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "appointments"
  ADD COLUMN "source" "AppointmentSource" NOT NULL DEFAULT 'OWNER';

ALTER TABLE "customers" ADD COLUMN "normalizedPhone" TEXT;
UPDATE "customers"
SET "normalizedPhone" = CASE
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^0[79][0-9]{8}$'
    THEN '+251' || substring(regexp_replace("phone", '[^0-9]', '', 'g') from 2)
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^251[79][0-9]{8}$'
    THEN '+' || regexp_replace("phone", '[^0-9]', '', 'g')
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^[79][0-9]{8}$'
    THEN '+251' || regexp_replace("phone", '[^0-9]', '', 'g')
  ELSE '+' || regexp_replace("phone", '[^0-9]', '', 'g')
END;
ALTER TABLE "customers" ALTER COLUMN "normalizedPhone" SET NOT NULL;

CREATE INDEX "businesses_isActive_isApproved_isSuspended_deletedAt_idx"
  ON "businesses"("isActive", "isApproved", "isSuspended", "deletedAt");
CREATE INDEX "businesses_name_idx" ON "businesses"("name");
CREATE INDEX "businesses_city_idx" ON "businesses"("city");
CREATE UNIQUE INDEX "customers_businessId_normalizedPhone_key"
  ON "customers"("businessId", "normalizedPhone");
CREATE INDEX "appointments_staffId_appointmentDate_startTime_idx"
  ON "appointments"("staffId", "appointmentDate", "startTime");
