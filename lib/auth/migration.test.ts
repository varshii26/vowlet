import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The accounts migration rebuilds the Wedding table (SQLite can't add a column
 * with a foreign key in place) and hands the existing wedding to the demo user.
 * That is what runs on the hosted demo's database at deploy, so it is tested on
 * a database built the old way, with data in it.
 */
const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const folders = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const sql = (folder: string) => readFileSync(path.join(migrationsDir, folder, "migration.sql"), "utf8");
const authMigration = folders.find((f) => f.endsWith("_auth_accounts"))!;

let dir: string | undefined;
let open: Database.Database | undefined;
afterEach(() => {
  open?.close(); // Windows won't delete a database file that is still open
  if (dir) rmSync(dir, { recursive: true, force: true });
  open = dir = undefined;
});

function databaseBefore(): Database.Database {
  dir = mkdtempSync(path.join(tmpdir(), "vowlet-mig-"));
  const db = (open = new Database(path.join(dir, "old.db")));
  db.pragma("foreign_keys = ON");
  for (const folder of folders.slice(0, folders.indexOf(authMigration))) db.exec(sql(folder));
  return db;
}

describe("the accounts migration", () => {
  it("gives the existing wedding to the demo user and keeps its vendors, payments and history", () => {
    const db = databaseBefore();
    db.prepare(`INSERT INTO "Wedding" (id, coupleNames, date, budget) VALUES ('w1', 'Priya & Sam', 1808000000000, 3600000)`).run();
    db.prepare(`INSERT INTO "Vendor" (id, weddingId, name, category, paypalEmail, contractPath, signingDate, totalCost) VALUES ('v1', 'w1', 'Grand Oak Estate', 'venue', 'a@b.c', 'x.pdf', 1800000000000, 900000)`).run();
    db.prepare(`INSERT INTO "Payment" (id, vendorId, label, amount, anchor) VALUES ('p1', 'v1', 'Deposit', 300000, 'signing_date')`).run();
    db.prepare(`INSERT INTO "EventLog" (id, weddingId, type, message) VALUES ('e1', 'w1', 'demo_seeded', 'Loaded')`).run();

    db.exec(sql(authMigration));

    expect(db.prepare(`SELECT id, name, email, isDemo, passwordHash FROM "User"`).all()).toEqual([
      { id: "demo-user", name: "Demo (Priya & Sam)", email: "demo@vowlet.invalid", isDemo: 1, passwordHash: null },
    ]);
    expect(db.prepare(`SELECT id, userId, coupleNames FROM "Wedding"`).all()).toEqual([{ id: "w1", userId: "demo-user", coupleNames: "Priya & Sam" }]);
    // Rebuilding the Wedding table must not cascade away what hangs off it.
    expect(db.prepare(`SELECT count(*) AS n FROM "Vendor"`).get()).toEqual({ n: 1 });
    expect(db.prepare(`SELECT count(*) AS n FROM "Payment"`).get()).toEqual({ n: 1 });
    expect(db.prepare(`SELECT count(*) AS n FROM "EventLog"`).get()).toEqual({ n: 1 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("creates no user on an empty database (the seed makes the demo user then)", () => {
    const db = databaseBefore();
    db.exec(sql(authMigration));
    expect(db.prepare(`SELECT count(*) AS n FROM "User"`).get()).toEqual({ n: 0 });
  });

  it("allows one wedding per user, and any number of unowned ones", () => {
    const db = databaseBefore();
    db.exec(sql(authMigration));
    db.prepare(`INSERT INTO "User" (id, email) VALUES ('u1', 'a@b.c')`).run();
    const wedding = db.prepare(`INSERT INTO "Wedding" (id, userId, coupleNames, date, budget) VALUES (?, ?, 'X', 1, 1)`);
    wedding.run("w1", "u1");
    expect(() => wedding.run("w2", "u1")).toThrow(/UNIQUE/);
    wedding.run("w3", null);
    wedding.run("w4", null);
  });

  it("keeps emails unique, and removes a user's accounts and wedding with them", () => {
    const db = databaseBefore();
    db.exec(sql(authMigration));
    db.prepare(`INSERT INTO "User" (id, email) VALUES ('u1', 'a@b.c')`).run();
    expect(() => db.prepare(`INSERT INTO "User" (id, email) VALUES ('u2', 'a@b.c')`).run()).toThrow(/UNIQUE/);
    db.prepare(`INSERT INTO "Account" (id, userId, type, provider, providerAccountId) VALUES ('a1', 'u1', 'oidc', 'google', 'g-1')`).run();
    expect(() => db.prepare(`INSERT INTO "Account" (id, userId, type, provider, providerAccountId) VALUES ('a2', 'u1', 'oidc', 'google', 'g-1')`).run()).toThrow(/UNIQUE/);
    db.prepare(`INSERT INTO "Wedding" (id, userId, coupleNames, date, budget) VALUES ('w1', 'u1', 'X', 1, 1)`).run();
    db.prepare(`DELETE FROM "User" WHERE id = 'u1'`).run();
    expect(db.prepare(`SELECT count(*) AS n FROM "Account"`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT count(*) AS n FROM "Wedding"`).get()).toEqual({ n: 0 });
  });
});
