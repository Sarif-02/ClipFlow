CREATE TABLE "Clip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalFilename" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "storedFilename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "duration" REAL,
    "width" INTEGER,
    "height" INTEGER,
    "codec" TEXT,
    "aspectRatio" TEXT,
    "audioCodec" TEXT,
    "audioChannels" INTEGER,
    "checksum" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'LOCAL',
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Clip_storedFilename_key" ON "Clip"("storedFilename");
CREATE UNIQUE INDEX "Clip_storagePath_key" ON "Clip"("storagePath");
CREATE UNIQUE INDEX "Clip_checksum_key" ON "Clip"("checksum");
CREATE INDEX "Clip_createdAt_idx" ON "Clip"("createdAt");
