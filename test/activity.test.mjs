import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createActivity, readActivitySnapshot } from "../activity.mjs";

test("counts all-time installations and calls without exposing identities or counting pings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-activity-"));
  const activity = createActivity(path.join(dir, "activity.sqlite"));
  try {
    const at = Date.now();
    activity.record({ family: "agent-a", tool: "query_graph", graph: "trac-marketing", ok: true, at });
    activity.record({ family: "agent-a", tool: "search_graph", graph: "trac-marketing", ok: true, at });
    activity.record({ family: "agent-b", tool: "write_working_memory", graph: "trac-marketing", ok: false, at });
    activity.record({ family: "agent-old", tool: "query_graph", graph: "trac-marketing", ok: true, at: at - 90000000 });
    activity.record({ family: "idle-client", tool: "ping", graph: "trac-marketing", ok: true, at });
    const snapshot = activity.snapshot(at);
    assert.equal(snapshot.connectedInstallations, 3);
    assert.equal(snapshot.queries, 3);
    assert.equal(snapshot.contributionAttempts, 1);
    assert.equal(snapshot.toolCalls, 4);
    assert.doesNotMatch(JSON.stringify(snapshot), /agent-a|agent-b/);
  } finally {
    activity.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration preserves legacy activity and classifies only newly observed tool outcomes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-activity-migration-"));
  const filename = path.join(dir, "activity.sqlite");
  const at = Date.parse("2026-10-07T12:00:00Z");
  const legacy = new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE activity (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, graph TEXT NOT NULL,
    installation TEXT NOT NULL, tool TEXT NOT NULL, ok INTEGER NOT NULL)`);
  legacy.prepare("INSERT INTO activity VALUES(1,?,'trac-marketing','legacy','write_working_memory',1)").run(at - 3600000);
  legacy.close();
  try {
    const before = readActivitySnapshot(filename, at);
    assert.equal(before.unknownOutcomeCalls, 1);
    assert.equal(before.successfulDraftSubmissions, 0);
    const untouched = new DatabaseSync(filename, { readOnly: true });
    assert.equal(untouched.prepare("PRAGMA table_info(activity)").all().length, 6);
    untouched.close();
    const activity = createActivity(filename);
    activity.record({ family: "new-reader", tool: "write_working_memory", graph: "trac-marketing", ok: false, at });
    activity.record({ family: "old-reader", tool: "query_graph", graph: "trac-marketing", ok: true, at: at - 2 * 86400000 });
    activity.record({ family: "outside-week", tool: "query_graph", graph: "trac-marketing", ok: true, at: at - 8 * 86400000 });
    activity.record({ family: "writer", tool: "write_working_memory", graph: "trac-marketing", ok: true, at: at - 86400000 });
    const snapshot = activity.snapshot(at);
    assert.equal(snapshot.toolCalls, 5);
    assert.equal(snapshot.unknownOutcomeCalls, 1);
    assert.equal(snapshot.failedToolCalls, 1);
    assert.equal(snapshot.successfulDraftSubmissions, 1);
    assert.equal(snapshot.windows.last24Hours.connectedInstallations, 3);
    assert.equal(snapshot.windows.last7Days.connectedInstallations, 4);
    assert.equal(snapshot.windows.last24Hours.unknownOutcomeCalls, 1);
    activity.close();
    const preserved = new DatabaseSync(filename, { readOnly: true });
    assert.deepEqual({ ...preserved.prepare("SELECT id,installation,ok,outcome_known FROM activity WHERE id=1").get() },
      { id: 1, installation: "legacy", ok: 1, outcome_known: 0 });
    preserved.close();
    assert.deepEqual(readActivitySnapshot(filename, at), snapshot);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
