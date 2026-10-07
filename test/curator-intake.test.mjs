import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { enqueueCuratorDraft, triggerCurator, routeDraft, deliverCollectivePush, retryCollectivePushes } from "../curator-intake.mjs";

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

test("routing bypasses review only for collective pushes and keeps errors queued", async () => {
  const events = [];
  const dependencies = { enqueue: (name) => events.push(["enqueue", name]),
    trigger: () => events.push(["review"]), deliver: async (name) => { events.push(["deliver", name]); return { promoted: name }; } };
  assert.deepEqual(await routeDraft("ordinary-draft", dependencies), { curatorReview: "queued" });
  assert.deepEqual(events, [["enqueue", "ordinary-draft"], ["review"]]);
  events.length = 0;
  const result = await routeDraft("COLLECTIVE_PUSH-demo", dependencies);
  assert.equal(result.delivery, "confirmed");
  assert.equal(result.curatorReview, "bypassed");
  assert.deepEqual(events, [["enqueue", "COLLECTIVE_PUSH-demo"], ["deliver", "COLLECTIVE_PUSH-demo"]]);
  assert.deepEqual(await routeDraft("collective-push-demo", { ...dependencies, deliver: async () => { throw new Error("DKG unavailable"); } }),
    { curatorReview: "bypassed", delivery: "retry-queued" });
});

test("deterministic delivery uses existing lock without shell or agent", async () => {
  let invocation;
  const result = await deliverCollectivePush("collective-push-demo", { executeFile: async (...args) => {
    invocation = args;
    return { stdout: '{"name":"collective-push-demo"}\n{"promoted":"curator-push-demo","recovered":true}\n' };
  } });
  assert.equal(result.recovered, true);
  assert.equal(invocation[0], "/usr/bin/flock");
  assert.deepEqual(invocation[1], ["-w", "5", "/run/lock/trac-marketing-curator.lock", process.execPath,
    "/root/dkg-swarm-webhooks/curator.mjs", "promote-community", "collective-push-demo"]);
  await assert.rejects(deliverCollectivePush("collective-push-;bad"), /invalid/);
  await assert.rejects(deliverCollectivePush("collective-push-demo", { executeFile: async () => ({ stdout: '{}' }) }), /acknowledgment/);
});

test("durable retry selects pushes without reviewing ordinary drafts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curator-retry-"));
  const filename = path.join(dir, "intake.sqlite");
  try {
    enqueueCuratorDraft("ordinary-draft", { filename });
    enqueueCuratorDraft("collective-push-demo", { filename });
    const db = new DatabaseSync(filename);
    assert.equal(db.prepare("SELECT mode FROM drafts WHERE name = ?").get("collective-push-demo").mode, "delivery");
    db.close();
    const delivered = [];
    await retryCollectivePushes({ filename, deliver: async (name) => { delivered.push(name); throw new Error("temporary"); } });
    await retryCollectivePushes({ filename, deliver: async (name) => delivered.push(name) });
    assert.deepEqual(delivered, ["collective-push-demo", "collective-push-demo"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("retry rotates failed pushes so older errors cannot starve later delivery", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curator-fair-retry-"));
  const filename = path.join(dir, "intake.sqlite");
  try {
    for (let i = 0; i < 11; i++) enqueueCuratorDraft(`collective-push-${i}`, { filename });
    const delivered = [];
    const deliver = async (name) => { delivered.push(name); throw new Error("temporary"); };
    await retryCollectivePushes({ filename, deliver });
    assert.equal(delivered.length, 10);
    assert.equal(delivered.includes("collective-push-10"), false);
    await retryCollectivePushes({ filename, deliver });
    assert.equal(delivered[10], "collective-push-10");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("server retains writer, policy and validation gates before draft creation", () => {
  const source = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("async ({ name, text, sourceUrl"), source.indexOf('"share_to_swm"'));
  const creation = handler.indexOf('dkgFetch("/api/knowledge-assets"');
  for (const gate of ["requireWrite();", "Writer installation unavailable", "Owner policy names are reserved", "validateCollectivePush("]) {
    assert.ok(handler.indexOf(gate) >= 0 && handler.indexOf(gate) < creation);
  }
  assert.ok(handler.indexOf("await routeDraft(slug)") > creation);
  assert.match(handler, /finalize: false/);
  assert.match(handler, /alsoShareSwm: false/);
});

test("trigger queues nonblocking systemd start", () => {
  let called;
  triggerCurator({ spawnProcess: (...args) => {
    called = args;
    return { on() {}, unref() {} };
  } });
  assert.deepEqual(called.slice(0, 2), ["/usr/bin/systemctl", ["start", "--no-block", "trac-marketing-curator.service"]]);
});
