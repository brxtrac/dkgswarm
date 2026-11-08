import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runHealthCheck } from "../health-check.mjs";
import { publicHealth } from "../health-public.mjs";

const at = Date.parse("2026-10-15T12:00:00Z");
const healthy = () => ({ completed: 3, pending: 0, quarantined: 0, stuck: 0, notExact: 0,
  lastSuccessfulPoll: new Date(at).toISOString(), lastSearch: new Date(at).toISOString(), searchEnabled: true });
const options = (snapshot = healthy) => ({ write: false, clock: () => at,
  service: (args) => { assert.equal(args[0], "is-active"); return "active"; },
  query: async () => ({ ok: true }), snapshot });

test("healthy check probes WM and SWM with no production dependencies", async () => {
  const views = [];
  const status = await runHealthCheck({ ...options(), query: async (view) => { views.push(view); return { ok: true }; } });
  assert.deepEqual(views, ["working-memory", "shared-working-memory"]);
  assert.equal(status.level, "green");
});

test("quarantine, stale search and trusted push backlog degrade health", async () => {
  for (const extra of [{ quarantined: 9 }, { lastSearch: "2020-01-01" }, { pushPending: 1, pushOldestDue: "2020-01-01" }]) {
    const status = await runHealthCheck(options(() => ({ ...healthy(), ...extra })));
    assert.equal(status.level, "yellow");
  }
});

test("stale or unknown polling and unavailable SWM report red", async () => {
  for (const lastSuccessfulPoll of [undefined, "2020-01-01", "2126-01-01"]) {
    assert.equal((await runHealthCheck(options(() => ({ ...healthy(), lastSuccessfulPoll })))).level, "red");
  }
  assert.equal((await runHealthCheck({ ...options(), query: async (view) => ({ ok: view === "working-memory" }) })).level, "red");
});

test("health reads fixture database without requeueing exhausted deliveries", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-health-"));
  const previous = process.env.WATCH_DB;
  process.env.WATCH_DB = path.join(directory, "watcher.sqlite");
  const db = new DatabaseSync(process.env.WATCH_DB);
  db.exec(`CREATE TABLE deliveries(stage TEXT, status TEXT, attempts INTEGER, next_attempt_at TEXT, last_error TEXT);
    CREATE TABLE runtime_metadata(key TEXT, value TEXT);
    INSERT INTO deliveries VALUES ('raw-dkg','pending',12,'2020-01-01','private error');`);
  try {
    const deps = options();
    delete deps.snapshot;
    const status = await runHealthCheck(deps);
    assert.equal(status.level, "red");
    assert.equal(db.prepare("SELECT attempts FROM deliveries").get().attempts, 12);
    assert.equal(JSON.stringify(status).includes("private"), false);
  } finally {
    db.close();
    if (previous === undefined) delete process.env.WATCH_DB; else process.env.WATCH_DB = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("public health rejects stale snapshots and overlays current collector failures", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-health-public-"));
  const filename = path.join(directory, "health.json");
  try {
    fs.writeFileSync(filename, JSON.stringify({ level: "green", checkedAt: "2020-01-01", summary: "ok" }));
    assert.equal(publicHealth(filename).level, "red");
    fs.writeFileSync(filename, JSON.stringify({ level: "green", checkedAt: new Date().toISOString(), summary: "ok" }));
    assert.equal(publicHealth(filename, { lastPoll: new Date().toISOString(), dkgFailures: [{}] }).level, "yellow");
    assert.equal(publicHealth(filename, { lastPoll: "2020-01-01" }).level, "red");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
