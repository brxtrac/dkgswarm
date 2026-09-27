import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";

export const INTAKE_PATH = process.env.TRAC_CURATOR_INTAKE || "/root/dkg-swarm-webhooks/data/curator-intake.sqlite";

export function enqueueCuratorDraft(name, { filename = INTAKE_PATH } = {}) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS drafts (name TEXT PRIMARY KEY, queued_at TEXT NOT NULL, reviewed_at TEXT);`);
    db.prepare(`INSERT INTO drafts (name, queued_at, reviewed_at) VALUES (?, ?, NULL)
      ON CONFLICT(name) DO UPDATE SET queued_at = excluded.queued_at, reviewed_at = NULL`)
      .run(name, new Date().toISOString());
  } finally { db.close(); }
}

export function triggerCurator({ spawnProcess = spawn } = {}) {
  const child = spawnProcess("/usr/bin/systemctl", ["start", "--no-block", "trac-marketing-curator.service"], {
    stdio: "ignore",
  });
  child.on?.("error", (error) => console.error("curator trigger failed", error));
  child.unref?.();
}
