// Actual supported sub-graph adapter. Calls are mocked in tests and never made
// during pre-production. Create is idempotent; readback verifies what was written.
import { mirrorPayload, sanitizeSummaryTopic } from "./mirror.mjs";

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

export async function mirrorJob({ job, config, apiBase, token, fetchImpl = fetch }) {
  if (config.mode !== "live") throw new SubgraphError("live-only", "graph mirror is available only in live mode");
  if (!config.graph.mirrorEnabled) throw new SubgraphError("disabled", "graph mirror is disabled by the operator");
  const payload = mirrorPayload(job);
  await ensureSubGraph({ apiBase, token, contextGraphId: config.graph.contextGraphId, subGraphName: config.graph.subGraphName, fetchImpl });
  const written = await writeSummary({ apiBase, token, contextGraphId: config.graph.contextGraphId, payload, fetchImpl });
  const readback = await readbackSummary({
    apiBase, token, contextGraphId: config.graph.contextGraphId,
    subGraphName: config.graph.subGraphName, subject: payload.subject, fetchImpl,
  });
  return { payload, written, readback };
}
