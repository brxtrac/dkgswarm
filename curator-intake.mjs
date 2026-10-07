import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { isCollectivePush } from "./collector/curator.mjs";

const execute = promisify(execFile);

export const INTAKE_PATH = process.env.TRAC_CURATOR_INTAKE || "/root/dkg-swarm-webhooks/data/curator-intake.sqlite";

export function enqueueCuratorDraft(name, { filename = INTAKE_PATH } = {}) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS drafts (name TEXT PRIMARY KEY, queued_at TEXT NOT NULL, reviewed_at TEXT);`);
    if (!db.prepare("PRAGMA table_info(drafts)").all().some((column) => column.name === "mode")) db.exec("ALTER TABLE drafts ADD COLUMN mode TEXT NOT NULL DEFAULT 'review'");
    db.prepare(`INSERT INTO drafts (name, queued_at, reviewed_at, mode) VALUES (?, ?, NULL, ?)
      ON CONFLICT(name) DO UPDATE SET queued_at = excluded.queued_at, reviewed_at = NULL, mode = excluded.mode`)
      .run(name, new Date().toISOString(), isCollectivePush(name) ? "delivery" : "review");
  } finally { db.close(); }
}

export async function deliverCollectivePush(name, { executeFile = execute } = {}) {
  if (!isCollectivePush(name) || !/^[a-zA-Z0-9._-]{1,80}$/.test(name)) throw new Error("invalid collective push name");
  const { stdout } = await executeFile("/usr/bin/flock", ["-w", "5", "/run/lock/trac-marketing-curator.lock",
    process.execPath, "/root/dkg-swarm-webhooks/curator.mjs", "promote-community", name], {
    timeout: 180000, maxBuffer: 1024 * 1024,
  });
  const acknowledgment = stdout.trim().split("\n").map((line) => JSON.parse(line)).findLast((row) => row.promoted);
  if (!acknowledgment) throw new Error("delivery acknowledgment missing");
  return acknowledgment;
}

export async function routeDraft(name, { enqueue = enqueueCuratorDraft, deliver = deliverCollectivePush, trigger = triggerCurator } = {}) {
  enqueue(name);
  if (!isCollectivePush(name)) {
    trigger();
    return { curatorReview: "queued" };
  }
  try {
    return { curatorReview: "bypassed", delivery: "confirmed", acknowledgment: await deliver(name) };
  } catch {
    return { curatorReview: "bypassed", delivery: "retry-queued" };
  }
}

export async function retryCollectivePushes({ filename = INTAKE_PATH, deliver = deliverCollectivePush } = {}) {
  if (!fs.existsSync(filename)) return;
  const db = new DatabaseSync(filename);
  let names;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    if (!db.prepare("PRAGMA table_info(drafts)").all().some((column) => column.name === "delivery_attempt_at")) db.exec("ALTER TABLE drafts ADD COLUMN delivery_attempt_at TEXT");
    names = db.prepare("SELECT name FROM drafts WHERE reviewed_at IS NULL ORDER BY COALESCE(delivery_attempt_at, ''), queued_at").all()
      .filter((row) => isCollectivePush(row.name)).slice(0, 10);
    const attempted = db.prepare("UPDATE drafts SET delivery_attempt_at = ? WHERE name = ?");
    for (const { name } of names) attempted.run(new Date().toISOString(), name);
  } finally { db.close(); }
  for (const { name } of names) {
    try { await deliver(name); } catch {}
  }
}

export function triggerCurator({ spawnProcess = spawn } = {}) {
  // Always signal: suppressing a second trigger can strand a draft after the
  // first curator run exits. systemd coalesces starts while the unit is active.
  const child = spawnProcess("/usr/bin/systemctl", ["start", "--no-block", "trac-marketing-curator.service"], {
    stdio: "ignore",
  });
  child.on?.("error", (error) => console.error("curator trigger failed", error));
  child.unref?.();
}
