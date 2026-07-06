-- AlterTable
ALTER TABLE "CheckSession" ADD COLUMN     "completedPolygons" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "progressMessage" TEXT,
ADD COLUMN     "totalPolygons" INTEGER NOT NULL DEFAULT 0;
