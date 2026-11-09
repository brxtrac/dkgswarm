#!/usr/bin/env node
// Offline dry run: no DKG, X, model, or network calls.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimCore, enqueueBatchCore, listJobs, loadConfig, reportCore } from "./jobs.mjs";
import { mirrorPayload } from "./mirror.mjs";
import fixtures from "./fixtures/opportunities.json" with { type: "json" };

const dir = mkdtempSync(join(tmpdir(), "scout-lane-dryrun-"));
const configPath = join(dir, "scout-lane.json");
const dbPath = join(dir, "jobs.sqlite");
writeFileSync(configPath, JSON.stringify({
  mode: "dry-run",
  operatorOptIn: true,
  scoutModel: null,
  approvedModels: [],
  availableModels: [],
  graph: { contextGraphId: "trac-marketing", subGraphName: "scout-jobs", view: "shared-working-memory", mirrorEnabled: false },
  publish: { defaultMode: "draft", preauthorized: false, allowedMethods: ["manual"] },
  accounts: ["fixture-account"],
  limits: { maxBriefsPerRun: 10, maxBriefsPerDay: 20 },
}, null, 2));
const config = loadConfig(configPath);
const batch = enqueueBatchCore({ dbPath, config, scoutId: "fixture-scout", opportunities: fixtures, accounts: ["fixture-account"] });
const claimed = claimCore({ dbPath, config, workerId: "fixture-worker", accounts: ["fixture-account"] });
let worker = null;
if (claimed.claimed) {
  const drafted = reportCore({
    dbPath, config, jobId: claimed.job.id, workerId: "fixture-worker",
    fencingToken: claimed.fencingToken, revision: claimed.revision, status: "drafted",
    content: "Fixture draft: a short sourced summary, no adoption or price claims.",
  });
  worker = { claimed: true, fence: claimed.fencingToken, revision: claimed.revision, report: drafted.ok ? { ok: true, state: drafted.job.state } : drafted };
}
const jobs = listJobs({ dbPath, config, operator: true });
console.log(JSON.stringify({
  mode: "dry-run",
  networkCalls: 0,
  note: "example.com URLs are documentation placeholders, not live sources.",
  accepted: batch.accepted.map((job) => ({ id: job.id.slice(0, 8), state: job.state, action: job.action })),
  rejected: batch.rejected,
  worker,
  states: jobs.map((job) => ({ id: job.id.slice(0, 8), state: job.state, action: job.action })),
  mirrorSample: jobs[0] ? mirrorPayload(jobs[0]) : null,
}, null, 2));
