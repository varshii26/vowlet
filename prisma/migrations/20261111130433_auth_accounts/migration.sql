-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" DATETIME,
    "image" TEXT,
    "passwordHash" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Wedding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "coupleNames" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "budget" INTEGER NOT NULL,
    CONSTRAINT "Wedding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Wedding" ("budget", "coupleNames", "date", "id") SELECT "budget", "coupleNames", "date", "id" FROM "Wedding";
DROP TABLE "Wedding";
ALTER TABLE "new_Wedding" RENAME TO "Wedding";
CREATE UNIQUE INDEX "Wedding_userId_key" ON "Wedding"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- Data: weddings from before accounts existed belong to nobody. The one that is there
-- (the seeded Priya & Sam demo) goes to the demo user, so the hosted demo keeps working
-- after the deploy. Nothing happens on an empty database (the seed creates the user then).
INSERT INTO "User" ("id", "name", "email", "isDemo")
SELECT 'demo-user', 'Demo (Priya & Sam)', 'demo@vowlet.invalid', true
WHERE EXISTS (SELECT 1 FROM "Wedding");

UPDATE "Wedding" SET "userId" = 'demo-user'
WHERE "id" = (SELECT "id" FROM "Wedding" WHERE "userId" IS NULL LIMIT 1);
