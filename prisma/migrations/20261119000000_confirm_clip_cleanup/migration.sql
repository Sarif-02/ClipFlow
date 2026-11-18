ALTER TABLE "Clip" ADD COLUMN "activeChecksum" TEXT;
UPDATE "Clip" SET "activeChecksum" = "checksum" WHERE "status" <> 'MEDIA_REMOVED';
CREATE UNIQUE INDEX "Clip_activeChecksum_key" ON "Clip"("activeChecksum");
DROP INDEX "Clip_checksum_key";

ALTER TABLE "CleanupTask" ADD COLUMN "requestedByPostId" TEXT;
-- Retire automatic tasks created before per-publication confirmation. Finish removals already in progress.
DELETE FROM "CleanupTask" WHERE "state" = 'PENDING' AND "clipId" NOT IN (
    SELECT "id" FROM "Clip" WHERE "status" = 'PURGING'
);
