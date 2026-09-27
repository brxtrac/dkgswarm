import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { enqueueCuratorDraft, triggerCurator } from "../curator-intake.mjs";

test("curator intake records each draft once and requeues updated drafts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curator-intake-"));
  const filename = path.join(dir, "intake.sqlite");
  enqueueCuratorDraft("collective-push-123", { filename });
  const db = new DatabaseSync(filename);
  db.prepare("UPDATE drafts SET reviewed_at = '2026-01-01' WHERE name = 'collective-push-123'").run();
  db.close();
  enqueueCuratorDraft("collective-push-123", { filename });
  const result = new DatabaseSync(filename, { readOnly: true });
  assert.deepEqual(result.prepare("SELECT name, reviewed_at FROM drafts").all().map((row) => ({ ...row })), [{ name: "collective-push-123", reviewed_at: null }]);
  result.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("trigger queues nonblocking systemd start", () => {
  let called;
  triggerCurator({ spawnProcess: (...args) => {
    called = args;
    return { on() {}, unref() {} };
  } });
  assert.deepEqual(called.slice(0, 2), ["/usr/bin/systemctl", ["start", "--no-block", "trac-marketing-curator.service"]]);
});
