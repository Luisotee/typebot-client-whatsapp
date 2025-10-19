-- CreateTable
CREATE TABLE "WhitelistedUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "waId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WhitelistedUser_waId_key" ON "WhitelistedUser"("waId");

-- CreateIndex
CREATE INDEX "WhitelistedUser_waId_idx" ON "WhitelistedUser"("waId");
