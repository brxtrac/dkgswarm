#!/usr/bin/env node
// Offline dry run: no DKG, X, model, or network calls.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claim, enqueue, listJobs, preflight, report, loadConfig } from "./jobs.mjs";
import { mirrorPayload } from "./mirror.mjs";
import fixtures from "./fixtures/opportunities.json" with { type: "json" };

const dir = mkdtempSync(join(tmpdir(), "scout-lane-dryrun-"));
process.env.FIXTURE_SCOUT_TOKEN = "fixture-scout-token";
process.env.FIXTURE_WORKER_TOKEN = "fixture-worker-token";
const configPath = join(dir, "scout-lane.json");
const dbPath = join(dir, "jobs.sqlite");
writeFileSync(configPath, JSON.stringify({
  mode: "dry-run",
  operatorOptIn: true,
  scoutModel: null,
  graph: { contextGraphId: "trac-marketing", subGraphName: "scout-jobs", view: "shared-working-memory", mirrorEnabled: false },
  publish: { defaultMode: "draft", preauthorized: false, allowedMethods: ["manual"] },
  accounts: ["fixture-account"],
  roles: { scouts: ["fixture-scout"], workers: ["fixture-worker"], publishers: [], operators: [] },
  tokens: {
    scouts: { "fixture-scout": { env: "FIXTURE_SCOUT_TOKEN" } },
    workers: { "fixture-worker": { env: "FIXTURE_WORKER_TOKEN" } },
    publishers: {}, operators: {},
  },
}, null, 2));

const results = [];
for (const fixture of fixtures) {
  try {
    const result = enqueue({ dbPath, configPath, scoutId: "fixture-scout", scoutToken: process.env.FIXTURE_SCOUT_TOKEN, opportunity: fixture });
    results.push({ fixture: fixture.fixture, ...result, job: result.job ? { id: result.job.id.slice(0, 8), state: result.job.state, action: result.job.action, provenance: result.job.provenance } : undefined });
  } catch (error) {
    results.push({ fixture: fixture.fixture, accepted: false, error: error.code, message: error.message });
  }
}
const claimed = claim({ dbPath, configPath, workerId: "fixture-worker", workerToken: process.env.FIXTURE_WORKER_TOKEN });
if (claimed.claimed) {
  const config = loadConfig(configPath);
  const gate = preflight(claimed.job, config);
  const drafted = report({
    dbPath, configPath, workerId: "fixture-worker", workerToken: process.env.FIXTURE_WORKER_TOKEN,
    jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision,
    status: "drafted", content: "Fixture draft: a short sourced summary, no adoption or price claims.",
  });
  results.push({ fixture: "worker", claimed: claimed.claimed, preflight: gate, report: drafted.ok ? { ok: true, state: drafted.job.state } : drafted });
}
const jobs = listJobs({ dbPath });
console.log(JSON.stringify({
  mode: "dry-run",
  networkCalls: 0,
  note: "Fixture URLs use the reserved .invalid TLD and are not live sources.",
  results,
  queuedStates: jobs.map((job) => ({ id: job.id.slice(0, 8), state: job.state, action: job.action })),
  mirrorSample: jobs[0] ? mirrorPayload(jobs[0]) : null,
}, null, 2));
