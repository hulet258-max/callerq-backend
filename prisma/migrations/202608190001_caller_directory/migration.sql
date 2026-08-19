CREATE TABLE "caller_directory_contacts" (
    "id" UUID NOT NULL,
    "contributorId" UUID NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "caller_directory_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "caller_directory_contacts_contributorId_normalizedPhone_key"
ON "caller_directory_contacts"("contributorId", "normalizedPhone");

CREATE INDEX "caller_directory_contacts_normalizedPhone_idx"
ON "caller_directory_contacts"("normalizedPhone");

ALTER TABLE "caller_directory_contacts"
ADD CONSTRAINT "caller_directory_contacts_contributorId_fkey"
FOREIGN KEY ("contributorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
