-- AlterTable
ALTER TABLE "EntityCheckSummary" ADD COLUMN     "failedPolygons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "suspectedBlock" BOOLEAN NOT NULL DEFAULT false;
