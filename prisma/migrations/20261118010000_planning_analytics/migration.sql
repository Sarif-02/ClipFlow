-- AlterTable
ALTER TABLE "Clip" ADD COLUMN "mediaRemovedAt" DATETIME;

-- CreateTable
CREATE TABLE "PublishingDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "scheduleMode" TEXT NOT NULL DEFAULT 'NOW',
    "scheduleLocal" TEXT NOT NULL DEFAULT '',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "timezone" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT,
    "clipId" TEXT,
    "clipKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "PublishingDraft" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Post_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PostTarget_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostTarget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountGroupMember" (
    "groupId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    PRIMARY KEY ("groupId", "accountId"),
    CONSTRAINT "AccountGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccountGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountGroupMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicationHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetId" TEXT,
    "filename" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "remoteAccount" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledAt" DATETIME,
    "publishedAt" DATETIME,
    "remoteMediaId" TEXT,
    "remoteUrl" TEXT,
    "checksum" TEXT,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicationHistory_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "PostTarget" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalyticsCache" (
    "accountId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,

    PRIMARY KEY ("accountId", "key"),
    CONSTRAINT "AnalyticsCache_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "PublishingDraft_status_updatedAt_idx" ON "PublishingDraft"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Post_clipId_status_idx" ON "Post"("clipId", "status");

-- CreateIndex
CREATE INDEX "Post_status_scheduledAt_idx" ON "Post"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_draftId_clipKey_key" ON "Post"("draftId", "clipKey");

-- CreateIndex
CREATE INDEX "PostTarget_accountId_status_idx" ON "PostTarget"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PostTarget_postId_accountId_key" ON "PostTarget"("postId", "accountId");

-- CreateIndex
CREATE INDEX "SocialAccount_platform_status_idx" ON "SocialAccount"("platform", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_platform_remoteId_key" ON "SocialAccount"("platform", "remoteId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountGroup_name_key" ON "AccountGroup"("name");

-- CreateIndex
CREATE INDEX "AccountGroupMember_accountId_idx" ON "AccountGroupMember"("accountId");

-- CreateIndex
CREATE INDEX "PublicationHistory_createdAt_idx" ON "PublicationHistory"("createdAt");

-- CreateIndex
CREATE INDEX "PublicationHistory_platform_status_publishedAt_idx" ON "PublicationHistory"("platform", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "PublicationHistory_targetId_status_idx" ON "PublicationHistory"("targetId", "status");

-- CreateIndex
CREATE INDEX "AnalyticsCache_expiresAt_idx" ON "AnalyticsCache"("expiresAt");
