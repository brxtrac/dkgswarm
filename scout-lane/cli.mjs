#!/usr/bin/env node
// Local operator/worker CLI. No network, no public MCP exposure.
import { readFileSync } from "node:fs";
import { claim, enqueue, expireJobs, listJobs, preflight, publish, report, resolveUncertain, loadConfig } from "./jobs.mjs";

const args = process.argv.slice(2);
const command = args.shift();
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}
const configPath = arg("config", process.env.SCOUT_LANE_CONFIG);
const dbPath = arg("db", process.env.SCOUT_LANE_DB);
if (!configPath || !dbPath) {
  console.error("SCOUT_LANE_CONFIG and SCOUT_LANE_DB (or --config/--db) are required");
  process.exit(2);
}
const out = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const roleToken = (role, id, override) => {
  if (override) return override;
  const spec = loadConfig(configPath).tokens?.[role]?.[id];
  return spec?.env ? process.env[spec.env] : undefined;
};

try {
  if (command === "enqueue") {
    const file = arg("opportunity", "-");
    const raw = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
    out(enqueue({ dbPath, configPath, scoutId: arg("scout"), scoutToken: roleToken("scouts", arg("scout"), arg("token")), opportunity: JSON.parse(raw) }));
  } else if (command === "claim") {
    out(claim({ dbPath, configPath, workerId: arg("worker"), workerToken: roleToken("workers", arg("worker"), arg("token")) }));
  } else if (command === "preflight") {
    const listed = listJobs({ dbPath, state: "claimed" });
    const job = listed.find((item) => item.id === arg("job"));
    out(job ? preflight(job, loadConfig(configPath)) : { ok: false, code: "not-found" });
  } else if (command === "report") {
    out(report({
      dbPath, configPath,
      workerId: arg("worker"), workerToken: roleToken("workers", arg("worker"), arg("token")),
      publisherId: arg("publisher"), publisherToken: roleToken("publishers", arg("publisher"), arg("publisher-token")),
      jobId: arg("job"), fencingToken: Number(arg("fence")), revision: Number(arg("revision")),
      status: arg("status"), resultUrl: arg("url"), resultStatus: arg("result-status"),
      reason: arg("reason"), content: arg("content"),
    }));
  } else if (command === "publish") {
    out(publish({
      dbPath, configPath,
      publisherId: arg("publisher"), publisherToken: roleToken("publishers", arg("publisher"), arg("token")),
      jobId: arg("job"), resultUrl: arg("url"), resultStatus: arg("result-status"),
    }));
  } else if (command === "resolve") {
    out(resolveUncertain({
      dbPath, configPath,
      operatorId: arg("operator"), operatorToken: roleToken("operators", arg("operator"), arg("token")),
      jobId: arg("job"), resolution: arg("resolution"), resultUrl: arg("url"), reason: arg("reason"),
    }));
  } else if (command === "list") {
    out(listJobs({ dbPath, state: arg("state"), limit: Number(arg("limit", 20)) }));
  } else if (command === "expire") {
    out(expireJobs({ dbPath }));
  } else {
    console.error("usage: cli.mjs enqueue|claim|preflight|report|publish|resolve|list|expire --config <file> --db <file> ...");
    process.exit(2);
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.code || "error", message: error.message }));
  process.exit(1);
}
