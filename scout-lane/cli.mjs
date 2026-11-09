#!/usr/bin/env node
// Local operator inspection only. Mutating dispatch runs through authenticated
// MCP tools; the bounded scout runner is scout-run.mjs.
import {
  expireJobs, getJob, listJobs, loadConfig,
} from "./jobs.mjs";

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
const config = loadConfig(configPath);
const out = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

if (command === "list") out(listJobs({ dbPath, config, state: arg("state"), operator: true, limit: Number(arg("limit", 20)) }));
else if (command === "show") out(getJob({ dbPath, config, jobId: arg("job") }));
else if (command === "expire") out(expireJobs({ dbPath, config }));
else {
  console.error("usage: cli.mjs list|show|expire --config <file> --db <file>");
  process.exit(2);
}
