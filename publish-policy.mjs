import fs from "node:fs";
import { policyDigest, verifyPolicyBindings } from "./policy-integrity.mjs";

const filename = process.argv[2];
if (!filename) throw new Error("Usage: node publish-policy.mjs <policy-vN.json>");
const policy = JSON.parse(fs.readFileSync(filename, "utf8"));
if (policy.kind !== "swarm-coordination-policy" || !Number.isSafeInteger(policy.version) || policy.version < 1) throw new Error("Invalid policy");
const pointer = process.env.DKG_MCP_POLICY_CURRENT || "/root/dkg-public-mcp/policy-current.json";
const current = JSON.parse(fs.readFileSync(pointer, "utf8"));
if (policy.version !== current.version + 1) throw new Error(`Expected policy v${current.version + 1}; refusing overwrite or skipped version`);
if (policy.contextGraphId !== "trac-marketing") throw new Error("Policy graph mismatch");
const token = (process.env.DKG_API_TOKEN || fs.readFileSync("/root/.dkg/auth.token", "utf8").split(/\n/).find((line) => line.trim() && !line.startsWith("#")) || "").trim();
if (!token) throw new Error("DKG API token missing");
const name = `swarm-policy-v${policy.version}`;
const subject = `https://www.dkgswarm.com/ka/${name}`;
const lit = (value) => JSON.stringify(value);
const api = (process.env.DKG_API_URL || "http://127.0.0.1:9200").replace(/\/$/, "");
const request = async (url, body) => {
  const response = await fetch(`${api}${url}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`DKG ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
};
await request("/api/knowledge-assets", {
  contextGraphId: "trac-marketing", name, finalize: false, alsoShareSwm: false,
  quads: [
    { subject, predicate: "http://www.w3.org/2000/01/rdf-schema#label", object: lit(name) },
    { subject, predicate: "http://www.w3.org/2000/01/rdf-schema#comment", object: lit(JSON.stringify(policy)) },
  ],
});
await request(`/api/knowledge-assets/${name}/swm/share`, { contextGraphId: "trac-marketing" });
const confirmed = await request("/api/query", {
  contextGraphId: "trac-marketing", view: "shared-working-memory",
  sparql: `SELECT ?o WHERE { <${subject}> <http://www.w3.org/2000/01/rdf-schema#comment> ?o } LIMIT 2`,
});
const sha256 = policyDigest(policy);
verifyPolicyBindings(confirmed?.result?.bindings, { version: policy.version, sha256, contextGraphId: "trac-marketing" });
const temp = `${pointer}.${process.pid}.tmp`;
fs.writeFileSync(temp, JSON.stringify({ version: policy.version, sha256 }) + "\n", { mode: 0o600 });
fs.renameSync(temp, pointer);
console.log(`Shared ${name} in DKG Shared Working Memory`);
