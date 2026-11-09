#!/usr/bin/env node
// Bounded scout runner. No schedule and no automatic activation.
// Requires live mode, an exact approved/available model, a public URL list,
// and DKG_SCOUT_MODEL_ENDPOINT / DKG_SCOUT_API_KEY in the process environment.
import { readFileSync } from "node:fs";
import { runScout, createHttpModelAdapter, createPublicReadAdapter } from "./scout.mjs";
import { verifyLocalGrant } from "./capabilities.mjs";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}
const configPath = arg("config", process.env.SCOUT_LANE_CONFIG);
const dbPath = arg("db", process.env.SCOUT_LANE_DB);
const sourcesPath = arg("sources");
const capabilitiesPath = arg("capabilities", process.env.SCOUT_LANE_CAPABILITIES);
const grantId = arg("grant", process.env.DKG_SCOUT_GRANT);
const grantToken = arg("token", process.env.DKG_SCOUT_GRANT_TOKEN);
if (!configPath || !dbPath || !sourcesPath || !capabilitiesPath || !grantId) {
  console.error("--config, --db, --sources, --capabilities and --grant are required");
  process.exit(2);
}
const grant = verifyLocalGrant(capabilitiesPath, grantId, grantToken);
const endpoint = process.env.DKG_SCOUT_MODEL_ENDPOINT;
const apiKey = process.env.DKG_SCOUT_API_KEY;
if (!endpoint || !apiKey) {
  console.error("DKG_SCOUT_MODEL_ENDPOINT and DKG_SCOUT_API_KEY are required");
  process.exit(2);
}
const parsed = JSON.parse(readFileSync(sourcesPath, "utf8"));
const sources = (Array.isArray(parsed) ? parsed : parsed.sources || []).map((row) => typeof row === "string" ? row : row.url);
const result = await runScout({
  configPath, dbPath, sources, scoutId: grant.id, accounts: grant.accounts,
  publicAdapter: createPublicReadAdapter(),
  modelAdapter: createHttpModelAdapter({ endpoint, apiKey }),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
