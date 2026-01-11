-- CreateTable
CREATE TABLE "ActiveChoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "waId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "choices" TEXT NOT NULL,
    "typebotSlug" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExpectedInputType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "waId" TEXT NOT NULL,
    "inputType" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ActiveChoice_waId_key" ON "ActiveChoice"("waId");

-- CreateIndex
CREATE INDEX "ActiveChoice_expiresAt_idx" ON "ActiveChoice"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedInputType_waId_key" ON "ExpectedInputType"("waId");

-- CreateIndex
CREATE INDEX "ExpectedInputType_expiresAt_idx" ON "ExpectedInputType"("expiresAt");
