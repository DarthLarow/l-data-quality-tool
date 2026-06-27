-- AlterTable
ALTER TABLE "AlertThreshold" ADD COLUMN     "mismatchCountCritical" INTEGER,
ADD COLUMN     "mismatchCountWarning" INTEGER,
ADD COLUMN     "missingCountCritical" INTEGER,
ADD COLUMN     "missingCountWarning" INTEGER;
