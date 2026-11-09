import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const NOW = Date.now();

export function setup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scout-lane-test-"));
  const configPath = join(dir, "scout-lane.json");
  const dbPath = join(dir, "jobs.sqlite");
  const statusesPath = join(dir, "capabilities.json");
  const config = {
    mode: "dry-run",
    operatorOptIn: true,
    scoutModel: null,
    approvedModels: ["9router/cx/gpt-6.1-sol"],
    availableModels: ["9router/cx/gpt-6.1-sol"],
    availableModelsVerifiedAt: new Date(NOW).toISOString(),
    graph: { contextGraphId: "trac-marketing", subGraphName: "scout-jobs", view: "shared-working-memory", mirrorEnabled: false },
    publish: { defaultMode: "draft", preauthorized: false, allowedMethods: ["manual"] },
    accounts: ["acct-1"],
    limits: { leaseMinutes: 10, jobTtlMinutes: 120, maxJobTtlMinutes: 1440, submitTimeoutMinutes: 5, failureCooldownMinutes: 360, maxClaimsPerDay: 10, maxBriefsPerDay: 20, maxBriefsPerRun: 5, maxPerAccountPerDay: 3 },
    roles: { scouts: ["scout-1"], workers: ["worker-1", "worker-2"], publishers: ["publisher-1"], operators: ["operator-1"] },
    tokens: {},
    ...overrides,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { dir, configPath, dbPath, statusesPath, config, now: NOW };
}

export function live(overrides = {}) {
  return setup({
    mode: "live",
    scoutModel: "9router/cx/gpt-6.1-sol",
    ...overrides,
  });
}

export function opportunity(overrides = {}) {
  return {
    platform: "x",
    action: "original",
    accountScope: "acct-1",
    topic: "OriginTrail DKG public documentation",
    brief: "Write a short sourced post about the public DKG documentation. No price or adoption claims.",
    relevance: 0.8,
    sources: [{ url: "https://example.com/docs/one" }],
    ...overrides,
  };
}

export async function raceChild({ dbPath, configPath, workerId, accounts, now, mode = "claim" }) {
  const script = join(here, "race-child.mjs");
  const { stdout } = await run(process.execPath, [script, dbPath, configPath, workerId, String(now), JSON.stringify(accounts), mode], { timeout: 20_000 });
  return JSON.parse(stdout);
}

export { NOW };
