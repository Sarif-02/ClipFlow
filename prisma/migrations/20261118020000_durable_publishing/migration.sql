-- AlterTable
ALTER TABLE "PublishingDraft" ADD COLUMN "submissionKey" TEXT;

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "provider" TEXT NOT NULL PRIMARY KEY,
    "values" JSONB NOT NULL,
    "secrets" TEXT,
    "status" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "validatedAt" DATETIME,
    "connectedAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OAuthCredential" (
    "accountId" TEXT NOT NULL PRIMARY KEY,
    "sealed" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OAuthCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "verifier" TEXT,
    "reconnectId" TEXT,
    "redirectUri" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "scheduledAt" DATETIME,
    "nativeSchedule" BOOLEAN NOT NULL DEFAULT false,
    "leaseOwner" TEXT,
    "leaseUntil" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "remoteId" TEXT,
    "remoteUrl" TEXT,
    "checkpoint" TEXT,
    "uploadedBytes" INTEGER,
    "error" TEXT,
    "errorKind" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "PostTarget" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "PublishAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuotaUsage" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "used" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seenAt" DATETIME NOT NULL,
    "running" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "CleanupTask" (
    "clipId" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "dueAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

ALTER TABLE "SocialAccount" ADD COLUMN "avatar" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "canPublish" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SocialAccount" ADD COLUMN "canAnalyze" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SocialAccount" ADD COLUMN "verifiedAt" DATETIME;

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_targetId_key" ON "Job"("targetId");

-- CreateIndex
CREATE INDEX "Job_state_dueAt_idx" ON "Job"("state", "dueAt");

-- CreateIndex
CREATE INDEX "Job_leaseUntil_idx" ON "Job"("leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PublishAttempt_jobId_number_key" ON "PublishAttempt"("jobId", "number");

-- CreateIndex
CREATE INDEX "QuotaUsage_expiresAt_idx" ON "QuotaUsage"("expiresAt");

-- CreateIndex
CREATE INDEX "CleanupTask_state_dueAt_idx" ON "CleanupTask"("state", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishingDraft_submissionKey_key" ON "PublishingDraft"("submissionKey");
