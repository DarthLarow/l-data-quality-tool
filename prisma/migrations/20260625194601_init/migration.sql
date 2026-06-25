-- CreateTable
CREATE TABLE "Scraper" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supportedEntityTypes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scraper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "environment" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "scrapersSessionId" INTEGER NOT NULL,
    "polygonIds" TEXT[],
    "entityTypes" TEXT[],
    "checksEnabled" TEXT[],
    "aiSampleSize" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'running',
    "triggeredBy" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "CheckSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolygonCheck" (
    "id" TEXT NOT NULL,
    "checkSessionId" TEXT NOT NULL,
    "polygonId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "apiEntityIds" TEXT[],
    "foundInDb" TEXT[],
    "notFoundInDb" TEXT[],

    CONSTRAINT "PolygonCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityCheckSummary" (
    "id" TEXT NOT NULL,
    "checkSessionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "totalUniqueInApi" INTEGER NOT NULL,
    "totalFoundInDb" INTEGER NOT NULL,
    "totalNotFoundInDb" INTEGER NOT NULL,

    CONSTRAINT "EntityCheckSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionDeltaCheck" (
    "id" TEXT NOT NULL,
    "checkSessionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "currentScrapersSessionId" INTEGER NOT NULL,
    "previousScrapersSessionId" INTEGER NOT NULL,
    "currentCount" INTEGER NOT NULL,
    "previousCount" INTEGER NOT NULL,
    "deltaPercent" DOUBLE PRECISION NOT NULL,
    "deltaFlag" TEXT NOT NULL,

    CONSTRAINT "SessionDeltaCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiComparison" (
    "id" TEXT NOT NULL,
    "checkSessionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "apiSnapshot" JSONB NOT NULL,
    "dbSnapshot" JSONB NOT NULL,
    "verdict" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "AiComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertThreshold" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "warningThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "criticalThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 50,

    CONSTRAINT "AlertThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoCheckConfig" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "entityTypes" TEXT[],
    "polygonStrategy" TEXT NOT NULL,
    "aiSampleSize" INTEGER NOT NULL DEFAULT 5,
    "checksEnabled" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AutoCheckConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Scraper_appId_key" ON "Scraper"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertThreshold_appId_entityType_key" ON "AlertThreshold"("appId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "AutoCheckConfig_appId_key" ON "AutoCheckConfig"("appId");

-- AddForeignKey
ALTER TABLE "CheckSession" ADD CONSTRAINT "CheckSession_appId_fkey" FOREIGN KEY ("appId") REFERENCES "Scraper"("appId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolygonCheck" ADD CONSTRAINT "PolygonCheck_checkSessionId_fkey" FOREIGN KEY ("checkSessionId") REFERENCES "CheckSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityCheckSummary" ADD CONSTRAINT "EntityCheckSummary_checkSessionId_fkey" FOREIGN KEY ("checkSessionId") REFERENCES "CheckSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDeltaCheck" ADD CONSTRAINT "SessionDeltaCheck_checkSessionId_fkey" FOREIGN KEY ("checkSessionId") REFERENCES "CheckSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiComparison" ADD CONSTRAINT "AiComparison_checkSessionId_fkey" FOREIGN KEY ("checkSessionId") REFERENCES "CheckSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertThreshold" ADD CONSTRAINT "AlertThreshold_appId_fkey" FOREIGN KEY ("appId") REFERENCES "Scraper"("appId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoCheckConfig" ADD CONSTRAINT "AutoCheckConfig_appId_fkey" FOREIGN KEY ("appId") REFERENCES "Scraper"("appId") ON DELETE CASCADE ON UPDATE CASCADE;
