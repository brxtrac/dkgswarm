// Actual supported sub-graph adapter. Calls are mocked in tests and never made
// during pre-production. Create is idempotent; readback verifies what was written.
import { mirrorPayload, sanitizeSummaryTopic } from "./mirror.mjs";

const NS = "https://www.dkgswarm.com/ontology/scout/";

export class SubgraphError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function base(value) { return String(value || "http://127.0.0.1:9200").replace(/\/$/, ""); }

async function request(fetchImpl, url, token, body, method = "POST") {
  const response = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 300) }; }
  return { ok: response.ok, status: response.status, payload };
}

export async function ensureSubGraph({ apiBase, token, contextGraphId, subGraphName, fetchImpl = fetch }) {
  if (!token) throw new SubgraphError("auth", "DKG API token required");
  const created = await request(fetchImpl, `${base(apiBase)}/api/sub-graph/create`, token, { contextGraphId, subGraphName });
  if (!created.ok && !/already exists/i.test(JSON.stringify(created.payload))) {
    throw new SubgraphError("create", `sub-graph create failed: ${created.status}`);
  }
  const listed = await request(fetchImpl, `${base(apiBase)}/api/sub-graph/list?contextGraphId=${encodeURIComponent(contextGraphId)}`, token, null, "GET");
  if (!listed.ok) throw new SubgraphError("list", `sub-graph list failed: ${listed.status}`);
  const names = new Set((listed.payload?.subGraphs || []).map((item) => item.name));
  if (!names.has(subGraphName)) throw new SubgraphError("missing", "sub-graph not present after create");
  return { created: created.ok, subGraphName, contextGraphId };
}

export async function writeSummary({ apiBase, token, contextGraphId, payload, fetchImpl = fetch }) {
  if (!token) throw new SubgraphError("auth", "DKG API token required");
  sanitizeSummaryTopic(payload.name);
  const written = await request(fetchImpl, `${base(apiBase)}/api/knowledge-assets`, token, {
    contextGraphId,
    name: payload.name,
    subGraphName: payload.subGraphName,
    finalize: false,
    alsoShareSwm: false,
    quads: payload.quads,
  });
  if (!written.ok) throw new SubgraphError("write", `summary write failed: ${written.status}`);
  return written.payload;
}

export async function readbackSummary({ apiBase, token, contextGraphId, subGraphName, subject, fetchImpl = fetch }) {
  if (!token) throw new SubgraphError("auth", "DKG API token required");
  const sparql = `SELECT ?p ?o WHERE { <${subject}> ?p ?o } LIMIT 20`;
  const result = await request(fetchImpl, `${base(apiBase)}/api/query`, token, { sparql, contextGraphId, subGraphName });
  if (!result.ok) throw new SubgraphError("readback", `summary readback failed: ${result.status}`);
  const bindings = result.payload?.result?.bindings || [];
  if (!bindings.length) throw new SubgraphError("readback-empty", "summary readback returned no triples");
  return { subject, bindings };
}

export function verifyReadback(payload, bindings) {
  const rows = bindings.map((row) => ({ p: typeof row.p === "string" ? row.p : row.p?.value, o: typeof row.o === "string" ? row.o : row.o?.value }));
  const values = new Map();
  for (const row of rows) {
    if (!row.p) continue;
    const list = values.get(row.p) || [];
    list.push(row.o);
    values.set(row.p, list);
  }
  const singleValued = new Set([
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", "https://schema.org/identifier",
    "https://schema.org/name", "https://schema.org/actionStatus", `${NS}platform`, `${NS}action`,
    "https://schema.org/startTime", "https://schema.org/endTime", "https://schema.org/target",
    "https://schema.org/url",
  ]);
  for (const quad of payload.quads) {
    const actual = values.get(quad.predicate) || [];
    if (!actual.includes(quad.object)) throw new SubgraphError("readback-mismatch", `readback is missing exact value for ${quad.predicate}`);
    if (singleValued.has(quad.predicate) && actual.length !== 1) throw new SubgraphError("readback-mismatch", `readback has duplicate values for ${quad.predicate}`);
  }
  const serialized = JSON.stringify(rows);
  for (const forbidden of ["account_scope", "accountScope", "brief", "worker_id", "workerId", "fencing", "revision", "submit_token"]) {
    if (serialized.includes(forbidden)) throw new SubgraphError("readback-private", "readback contains private job fields");
  }
  return true;
}

export async function mirrorJob({ job, config, apiBase, token, fetchImpl = fetch }) {
  if (!config.operatorOptIn) throw new SubgraphError("opt-in-required", "graph mirror requires explicit operator opt-in");
  if (config.mode !== "live") throw new SubgraphError("live-only", "graph mirror is available only in live mode");
  if (!config.graph.mirrorEnabled) throw new SubgraphError("disabled", "graph mirror is disabled by the operator");
  if (!config.graph.subGraphName) throw new SubgraphError("destination", "sub-graph destination is required");
  const payload = mirrorPayload(job, { subGraphName: config.graph.subGraphName });
  await ensureSubGraph({ apiBase, token, contextGraphId: config.graph.contextGraphId, subGraphName: config.graph.subGraphName, fetchImpl });
  const written = await writeSummary({ apiBase, token, contextGraphId: config.graph.contextGraphId, payload, fetchImpl });
  const readback = await readbackSummary({
    apiBase, token, contextGraphId: config.graph.contextGraphId,
    subGraphName: config.graph.subGraphName, subject: payload.subject, fetchImpl,
  });
  verifyReadback(payload, readback.bindings);
  return { payload, written, readback };
}
