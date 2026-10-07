import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runHealthCheck } from "../health-check.mjs";

function tempDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-health-"));
  const dbPath = path.join(directory, "watcher.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE observations (post_id TEXT PRIMARY KEY);
    CREATE TABLE deliveries (
      post_id TEXT NOT NULL REFERENCES observations(post_id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      completed_at TEXT,
      PRIMARY KEY (post_id, stage)
    );
    INSERT INTO observations (post_id) VALUES ('private-post-9');`);
  return { directory, dbPath, db };
}

test("health check requeues stuck pending rows and stays quiet about private ids", async () => {
  const { directory, dbPath, db } = tempDb();
  const statusPath = path.join(directory, "health-status.json");
  const previous = {
    WATCH_DB: process.env.WATCH_DB,
    SWARM_HEALTH_STATUS: process.env.SWARM_HEALTH_STATUS,
    SWARM_HEALTH_LOG: process.env.SWARM_HEALTH_LOG,
  };
  db.prepare(`INSERT INTO deliveries (post_id, stage, status, attempts, next_attempt_at, last_error)
    VALUES ('private-post-9', 'raw-dkg', 'pending', 12, ?, 'private error')`)
    .run("2020-01-01T00:00:00.000Z");
  db.close();
  process.env.WATCH_DB = dbPath;
  process.env.SWARM_HEALTH_STATUS = statusPath;
  process.env.SWARM_HEALTH_LOG = path.join(directory, "health.log");
  try {
    const status = await runHealthCheck({ restart: true, write: true });
    const after = new DatabaseSync(dbPath);
    const row = after.prepare("SELECT status, attempts, last_error FROM deliveries").get();
    after.close();
    assert.equal(row.status, "pending");
    assert.equal(row.attempts, 0);
    assert.equal(status.fixes.some((line) => line.includes("requeued 1")), true);
    const published = fs.readFileSync(statusPath, "utf8");
    assert.equal(published.includes("private"), false);
    assert.equal(published.includes("9200"), false);
    assert.match(published, /"level": "(green|yellow|red)"/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("public health file reports red when the daily check is stale", async () => {
  const { publicHealth } = await import("../health-public.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-health-public-"));
  const statusPath = path.join(directory, "health-status.json");
  fs.writeFileSync(statusPath, JSON.stringify({
    level: "green", summary: "ok", checkedAt: "2020-01-01T00:00:00.000Z",
  }));
  const stale = publicHealth(statusPath);
  assert.equal(stale.level, "red");
  assert.equal(stale.ok, false);
  assert.equal(JSON.stringify(stale).includes("private"), false);
  fs.rmSync(directory, { recursive: true, force: true });
});
