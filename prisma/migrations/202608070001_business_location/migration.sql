ALTER TABLE "businesses"
ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;

ALTER TABLE "businesses"
ADD CONSTRAINT "businesses_latitude_check"
CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90)),
ADD CONSTRAINT "businesses_longitude_check"
CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180)),
ADD CONSTRAINT "businesses_coordinates_pair_check"
CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
