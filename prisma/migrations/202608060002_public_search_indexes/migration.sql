-- Trigram indexes support case-insensitive contains searches in the public catalog.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS "businesses_name_idx";
DROP INDEX IF EXISTS "businesses_city_idx";

CREATE INDEX "businesses_name_idx" ON "businesses" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "businesses_city_idx" ON "businesses" USING GIN ("city" gin_trgm_ops);
CREATE INDEX "businesses_address_idx" ON "businesses" USING GIN ("address" gin_trgm_ops);
