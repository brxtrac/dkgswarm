import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export const TOKENS = {
  scout: "test-scout-token",
  worker: "test-worker-token",
  publisher: "test-publisher-token",
  operator: "test-operator-token",
};

export function setup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scout-lane-test-"));
  const configPath = join(dir, "scout-lane.json");
  const dbPath = join(dir, "jobs.sqlite");
  process.env.TEST_SCOUT_TOKEN = TOKENS.scout;
  process.env.TEST_WORKER_TOKEN = TOKENS.worker;
  process.env.TEST_PUBLISHER_TOKEN = TOKENS.publisher;
  process.env.TEST_OPERATOR_TOKEN = TOKENS.operator;
  const config = {
    mode: "dry-run",
    operatorOptIn: true,
    scoutModel: null,
    graph: { contextGraphId: "trac-marketing", subGraphName: "scout-jobs", view: "shared-working-memory", mirrorEnabled: false },
    publish: { defaultMode: "draft", preauthorized: false, allowedMethods: ["manual"] },
    accounts: ["acct-1"],
    limits: { leaseMinutes: 10, jobTtlMinutes: 120, failureCooldownMinutes: 360, maxClaimsPerDay: 10, maxPerAccountPerDay: 3, maxBriefsPerRun: 5 },
    roles: {
      scouts: ["scout-1"], workers: ["worker-1", "worker-2"],
      publishers: ["publisher-1"], operators: ["operator-1"],
    },
    tokens: {
      scouts: { "scout-1": { env: "TEST_SCOUT_TOKEN" } },
      workers: { "worker-1": { env: "TEST_WORKER_TOKEN" }, "worker-2": { env: "TEST_WORKER_TOKEN" } },
      publishers: { "publisher-1": { env: "TEST_PUBLISHER_TOKEN" } },
      operators: { "operator-1": { env: "TEST_OPERATOR_TOKEN" } },
    },
    ...overrides,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { dir, configPath, dbPath, config };
}

export function opportunity(overrides = {}) {
  return {
    platform: "x",
    action: "original",
    accountScope: "acct-1",
    topic: "OriginTrail DKG public documentation",
    brief: "Write a short sourced post about the public DKG documentation. No price or adoption claims.",
    relevance: 0.8,
    sources: [{ url: "https://fixtures.dkgswarm.invalid/docs/one" }],
    ...overrides,
  };
}

export async function raceChild({ dbPath, configPath, workerId, now }) {
  const script = join(here, "race-child.mjs");
  const { stdout } = await run(process.execPath, [script, dbPath, configPath, workerId, String(now)], {
    env: { ...process.env, TEST_WORKER_TOKEN: TOKENS.worker },
    timeout: 20_000,
  });
  return JSON.parse(stdout);
}

