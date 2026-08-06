ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'REQUESTED' BEFORE 'SCHEDULED';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'DECLINED';

CREATE TYPE "NotificationAudience" AS ENUM ('BUSINESS', 'CUSTOMER');
CREATE TYPE "PushPlatform" AS ENUM ('ANDROID', 'IOS');

ALTER TABLE "appointments"
  ADD COLUMN "responseReason" TEXT,
  ADD COLUMN "responseNote" TEXT,
  ADD COLUMN "respondedAt" TIMESTAMP(3),
  ADD COLUMN "respondedById" UUID,
  ADD COLUMN "requesterDeviceId" UUID;

ALTER TABLE "queue_entries" ADD COLUMN "appointmentId" UUID;
ALTER TABLE "notifications"
  ADD COLUMN "audience" "NotificationAudience" NOT NULL DEFAULT 'BUSINESS';

CREATE TABLE "push_devices" (
  "id" UUID NOT NULL,
  "installationId" TEXT NOT NULL,
  "fcmToken" TEXT NOT NULL,
  "platform" "PushPlatform" NOT NULL DEFAULT 'ANDROID',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_push_devices" (
  "userId" UUID NOT NULL,
  "deviceId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_push_devices_pkey" PRIMARY KEY ("userId", "deviceId")
);

CREATE TABLE "push_deliveries" (
  "id" UUID NOT NULL,
  "notificationId" UUID NOT NULL,
  "deviceId" UUID NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_devices_installationId_key" ON "push_devices"("installationId");
CREATE UNIQUE INDEX "push_devices_fcmToken_key" ON "push_devices"("fcmToken");
CREATE INDEX "push_devices_enabled_idx" ON "push_devices"("enabled");
CREATE INDEX "user_push_devices_deviceId_idx" ON "user_push_devices"("deviceId");
CREATE UNIQUE INDEX "queue_entries_appointmentId_key" ON "queue_entries"("appointmentId");
CREATE UNIQUE INDEX "push_deliveries_notificationId_deviceId_key"
  ON "push_deliveries"("notificationId", "deviceId");
CREATE INDEX "push_deliveries_deviceId_status_idx" ON "push_deliveries"("deviceId", "status");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_respondedById_fkey"
  FOREIGN KEY ("respondedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_requesterDeviceId_fkey"
  FOREIGN KEY ("requesterDeviceId") REFERENCES "push_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_push_devices" ADD CONSTRAINT "user_push_devices_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_push_devices" ADD CONSTRAINT "user_push_devices_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
