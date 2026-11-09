import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claim, enqueue, listJobs, loadConfig, preflight, publish, report, resolveUncertain } from "../jobs.mjs";
import { mirrorPayload } from "../mirror.mjs";
import { TOKENS, opportunity, raceChild, setup } from "./helpers.mjs";

const creds = (env, extra = {}) => ({ scoutId: "scout-1", scoutToken: TOKENS.scout, ...extra, ...env });

test("lane is opt-in: example and disabled config reject claim and enqueue", () => {
  const example = JSON.parse(JSON.stringify(loadConfig(new URL("../scout-lane.example.json", import.meta.url).pathname)));
  assert.equal(example.mode, "off");
  assert.equal(example.operatorOptIn, false);
  assert.equal(example.scoutModel, null);
  const { dbPath, configPath } = setup({ mode: "off", operatorOptIn: false });
  assert.throws(() => enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity() }), /disabled/);
  assert.throws(() => claim({ dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker }), /disabled/);
  assert.deepEqual(listJobs({ dbPath }), []);
});

test("live mode refuses to load without a verified scout model", () => {
  const { configPath } = setup({ mode: "live", scoutModel: null });
  assert.throws(() => loadConfig(configPath), /verified scoutModel/);
  const { configPath: okPath } = setup({ mode: "live", scoutModel: "9router/verified-id" });
  assert.equal(loadConfig(okPath).mode, "live");
});

test("unknown scout, wrong token and unapproved account are refused", () => {
  const { dbPath, configPath } = setup();
  assert.throws(() => enqueue({ dbPath, configPath, scoutId: "intruder", scoutToken: TOKENS.scout, opportunity: opportunity() }), /unknown scouts/);
  assert.throws(() => enqueue({ dbPath, configPath, scoutId: "scout-1", scoutToken: "wrong", opportunity: opportunity() }), /invalid scouts credential/);
  assert.throws(() => enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity({ accountScope: "other" }) }), /not in the operator allowlist/);
});

test("scout can abstain and invalid/expired/private/disallowed inputs are refused", () => {
  const { dbPath, configPath } = setup();
  assert.deepEqual(enqueue({ dbPath, configPath, ...creds(), opportunity: { abstain: true, reason: "no strong evidence" } }), {
    accepted: false, abstained: true, reason: "no strong evidence",
  });
  assert.throws(() => enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity({ action: "like", topic: "Boost this post" }) }), /action must be/);
  assert.throws(() => enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity({ targetUrl: "https://x.com/messages/1-2", action: "reply" }) }), /private messages/);
  assert.throws(() => enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity({ expiresAt: "2020-01-01T00:00:00.000Z" }) }), /already expired/);
  assert.throws(() => enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity({ sources: [] }) }), /public source/);
  assert.throws(() => enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity({ method: "browser-login" }) }), /not operator-approved/);
  assert.throws(() => enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity({ brief: "Create an account and solve the CAPTCHA to post this." }) }), /CAPTCHA/);
});

test("dedupe blocks the same source/platform/action/account and allows a different action", () => {
  const { dbPath, configPath } = setup();
  const now = 1_800_000_000_000;
  assert.equal(enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity(), now }).accepted, true);
  const duplicate = enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity({ brief: "Different angle, same action." }), now });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.duplicate, true);
  const reply = enqueue({
    dbPath, configPath, ...creds(), now,
    opportunity: opportunity({ action: "reply", targetUrl: "https://x.com/i/status/1234567890" }),
  });
  assert.equal(reply.accepted, true);
  assert.equal(listJobs({ dbPath }).length, 2);
});

test("two concurrent workers cannot both claim one job", async () => {
  const { dbPath, configPath } = setup();
  const now = 1_800_000_000_000;
  enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity(), now });
  const results = await Promise.all([
    raceChild({ dbPath, configPath, workerId: "worker-1", now }),
    raceChild({ dbPath, configPath, workerId: "worker-2", now }),
  ]);
  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.equal(results.filter((result) => !result.claimed).length, 1);
});

test("expired lease can be reclaimed and the stale fencing token is refused", () => {
  const { dbPath, configPath } = setup();
  const t0 = 1_800_000_000_000;
  enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity(), now: t0 });
  const first = claim({ dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker, now: t0 });
  assert.equal(first.claimed, true);
  const second = claim({ dbPath, configPath, workerId: "worker-2", workerToken: TOKENS.worker, now: t0 + 11 * 60_000 });
  assert.equal(second.claimed, true);
  assert.notEqual(second.fencingToken, first.fencingToken);
  const stale = report({
    dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker,
    jobId: first.job.id, fencingToken: first.fencingToken, revision: first.revision,
    status: "completed", resultUrl: "https://x.com/i/status/2222222222", resultStatus: "posted",
    now: t0 + 12 * 60_000,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "stale");
  const fresh = report({
    dbPath, configPath, workerId: "worker-2", workerToken: TOKENS.worker,
    jobId: second.job.id, fencingToken: second.fencingToken, revision: second.revision,
    status: "completed", resultUrl: "https://x.com/i/status/2222222222", resultStatus: "posted",
    now: t0 + 12 * 60_000,
  });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.job.state, "completed");
});

test("expired job is not claimable and can be rediscovered only after expiry", () => {
  const { dbPath, configPath } = setup();
  const t0 = 1_800_000_000_000;
  enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity({ expiresAt: new Date(t0 + 60_000).toISOString() }), now: t0 });
  assert.equal(claim({ dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker, now: t0 + 61_000 }).claimed, false);
  assert.equal(listJobs({ dbPath, now: t0 + 61_000 })[0].state, "expired");
  const again = enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity({ expiresAt: new Date(t0 + 3_600_000).toISOString() }), now: t0 + 62_000 });
  assert.equal(again.accepted, true);
});

test("uncertain freezes retries until an operator resolves it", () => {
  const { dbPath, configPath } = setup();
  const t0 = 1_800_000_000_000;
  enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity(), now: t0 });
  const claimed = claim({ dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker, now: t0 });
  const uncertain = report({
    dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker,
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
    status: "uncertain", reason: "submit response was ambiguous", now: t0 + 1000,
  });
  assert.equal(uncertain.ok, true);
  assert.equal(claim({ dbPath, configPath, workerId: "worker-2", workerToken: TOKENS.worker, now: t0 + 2000 }).claimed, false);
  assert.equal(enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity(), now: t0 + 2000 }).duplicate, true);
  const retry = resolveUncertain({
    dbPath, configPath, operatorId: "operator-1", operatorToken: TOKENS.operator,
    jobId: claimed.job.id, resolution: "retry", reason: "manual check found no post", now: t0 + 3000,
  });
  assert.equal(retry.ok, true);
  assert.equal(claim({ dbPath, configPath, workerId: "worker-2", workerToken: TOKENS.worker, now: t0 + 4000 }).claimed, true);
});

test("failed and skipped reports require a reason and create a cooldown", () => {
  const { dbPath, configPath } = setup();
  const t0 = 1_800_000_000_000;
  enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity(), now: t0 });
  const claimed = claim({ dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker, now: t0 });
  assert.throws(() => report({
    dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker,
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
    status: "failed", now: t0 + 1000,
  }), /reason must be/);
  const failed = report({
    dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker,
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
    status: "failed", reason: "pre-submit check refused the target", now: t0 + 1000,
  });
  assert.equal(failed.ok, true);
  const duplicate = enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity(), now: t0 + 2000 });
  assert.equal(duplicate.duplicate, true);
  assert.ok(duplicate.cooldownUntil > t0 + 2000);
});

test("preflight blocks disallowed jobs and draft mode is the default", () => {
  const { dbPath, configPath, config } = setup();
  const t0 = 1_800_000_000_000;
  enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity(), now: t0 });
  const claimed = claim({ dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker, now: t0 });
  const ok = preflight(claimed.job, config, t0 + 1000);
  assert.equal(ok.ok, true);
  assert.equal(claimed.job.publishMode, "draft");
  const blocked = preflight({ ...claimed.job, topic: "Boost this post", action: "repost" }, config, t0 + 1000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.checks.allowedAction, false);
  const preauthorized = preflight({ ...claimed.job, publishMode: "preauthorized" }, config, t0 + 1000);
  assert.equal(preauthorized.checks.publishAllowed, false);
});

test("publisher is a distinct credential and cannot publish draft-only jobs", () => {
  const { dbPath, configPath } = setup({ publish: { defaultMode: "preauthorized", preauthorized: true, allowedMethods: ["manual"] } });
  const t0 = 1_800_000_000_000;
  enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity(), now: t0 });
  const claimed = claim({ dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker, now: t0 });
  const drafted = report({
    dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker,
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
    status: "drafted", content: "A short sourced fixture draft, with no adoption or price claims.", now: t0 + 1000,
  });
  assert.equal(drafted.ok, true);
  assert.equal(drafted.job.state, "draft");
  assert.throws(() => publish({
    dbPath, configPath, publisherId: "publisher-1", publisherToken: "wrong",
    jobId: claimed.job.id, resultUrl: "https://x.com/i/status/3333333333", resultStatus: "posted", now: t0 + 2000,
  }), /invalid publishers credential/);
  const published = publish({
    dbPath, configPath, publisherId: "publisher-1", publisherToken: TOKENS.publisher,
    jobId: claimed.job.id, resultUrl: "https://x.com/i/status/3333333333", resultStatus: "posted", now: t0 + 2000,
  });
  assert.equal(published.ok, true);
  assert.equal(published.job.state, "published");
});

test("public mirror omits account scope, brief, worker and fencing data", () => {
  const { dbPath, configPath } = setup();
  const t0 = 1_800_000_000_000;
  enqueue({ dbPath, configPath, ...creds(), opportunity: opportunity(), now: t0 });
  const job = claim({ dbPath, configPath, workerId: "worker-1", workerToken: TOKENS.worker, now: t0 }).job;
  const payload = mirrorPayload(job);
  const serialized = JSON.stringify(payload);
  assert.equal(payload.subGraphName, "scout-jobs");
  assert.equal(serialized.includes("acct-1"), false);
  assert.equal(serialized.includes(job.brief), false);
  for (const key of ["accountScope", "brief", "worker", "fencing", "revision"]) assert.equal(serialized.includes(key), false);
});

test("example database stays empty when committed config is off", () => {
  const dir = mkdtempSync(join(tmpdir(), "scout-lane-off-"));
  const dbPath = join(dir, "jobs.sqlite");
  const configPath = join(dir, "off.json");
  writeFileSync(configPath, JSON.stringify({ mode: "off", operatorOptIn: false, graph: { contextGraphId: "trac-marketing" } }));
  assert.throws(() => claim({ dbPath, configPath, workerId: "worker-1", workerToken: "x" }), /disabled/);
  assert.deepEqual(listJobs({ dbPath }), []);
});
