-- AlterTable
ALTER TABLE "EntityCheckSummary" ADD COLUMN     "coverageNote" TEXT,
ADD COLUMN     "detailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "listOnlyCount" INTEGER NOT NULL DEFAULT 0;
