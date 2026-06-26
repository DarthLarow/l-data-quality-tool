-- AlterTable
ALTER TABLE "AutoCheckConfig" ADD COLUMN     "polygonCity" TEXT;

-- AlterTable
ALTER TABLE "Scraper" ADD COLUMN     "cities" TEXT[] DEFAULT ARRAY[]::TEXT[];
