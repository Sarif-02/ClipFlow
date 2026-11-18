ALTER TABLE "SocialAccount" ADD COLUMN "lastApiAt" DATETIME;
ALTER TABLE "SocialAccount" ADD COLUMN "authIssue" TEXT;
ALTER TABLE "OAuthCredential" ADD COLUMN "refreshedAt" DATETIME;

CREATE TABLE "ContentTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "ContentTemplate_kind_isDefault_idx" ON "ContentTemplate"("kind", "isDefault");

CREATE TABLE "AiSuggestion" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "content" JSONB NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

CREATE INDEX "AiSuggestion_expiresAt_idx" ON "AiSuggestion"("expiresAt");
