ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;
UPDATE "users" SET "role" = 'BUSINESS_OWNER' WHERE "role" = 'STAFF';
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
CREATE TYPE "UserRole_new" AS ENUM ('BUSINESS_OWNER', 'ADMIN');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'BUSINESS_OWNER';
ALTER TABLE "users" ADD COLUMN "googleUid" TEXT;
CREATE UNIQUE INDEX "users_googleUid_key" ON "users"("googleUid");

ALTER TABLE "businesses" ADD COLUMN "socialLinks" JSONB;
ALTER TABLE "businesses" ADD COLUMN "isOpen" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_favoriteStaffId_fkey";
ALTER TABLE "queue_entries" DROP CONSTRAINT IF EXISTS "queue_entries_staffId_fkey";
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_staffId_fkey";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_staffId_fkey";
DROP INDEX IF EXISTS "appointments_staffId_appointmentDate_startTime_idx";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "favoriteStaffId";
ALTER TABLE "queue_entries" DROP COLUMN IF EXISTS "staffId";
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "staffId";
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "reminderSent";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "staffId";
DROP TABLE IF EXISTS "staff";
CREATE INDEX "appointments_businessId_appointmentDate_startTime_idx"
  ON "appointments"("businessId", "appointmentDate", "startTime");

CREATE TYPE "ReminderKind" AS ENUM ('DAY_BEFORE', 'MINUTES_30', 'MINUTES_15');

CREATE TABLE "appointment_reminders" (
  "id" UUID NOT NULL,
  "appointmentId" UUID NOT NULL,
  "kind" "ReminderKind" NOT NULL,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appointment_reminders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_reminders_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "appointment_reminders_appointmentId_kind_key" ON "appointment_reminders"("appointmentId", "kind");
CREATE INDEX "appointment_reminders_sentAt_idx" ON "appointment_reminders"("sentAt");

CREATE TABLE "service_images" (
  "id" UUID NOT NULL,
  "serviceId" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "caption" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isCover" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_images_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "service_images_serviceId_sortOrder_idx" ON "service_images"("serviceId", "sortOrder");

CREATE TABLE "reviews" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "serviceId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "appointmentId" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "reviews_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reviews_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reviews_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "reviews_appointmentId_key" ON "reviews"("appointmentId");
CREATE INDEX "reviews_businessId_createdAt_idx" ON "reviews"("businessId", "createdAt");
CREATE INDEX "reviews_serviceId_idx" ON "reviews"("serviceId");
