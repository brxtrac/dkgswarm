import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { fetchPublicSource } from "../fetch-public.mjs";
import { mirrorPayload } from "../mirror.mjs";
import { ensureSubGraph, mirrorJob, readbackSummary, writeSummary } from "../subgraph.mjs";
import { canonicalPublicUrl } from "../jobs.mjs";
import { NOW, live, opportunity } from "./helpers.mjs";

test("bounded fetch rejects private DNS and redirects to private destinations", async () => {
  await assert.rejects(() => fetchPublicSource("https://127.0.0.1/x"), /private|reserved/);
  await assert.rejects(() => fetchPublicSource("https://example.com/x", {
    lookupImpl: async () => ["127.0.0.1"],
    requestImpl: async () => ({ statusCode: 200, headers: {}, body: "ok" }),
  }), /private address/);
  await assert.rejects(() => fetchPublicSource("https://example.com/x", {
    lookupImpl: async () => ["93.184.216.34"],
    requestImpl: async (url) => url.hostname === "example.com"
      ? { statusCode: 302, headers: { location: "https://127.0.0.1/x" }, body: "" }
      : { statusCode: 200, headers: {}, body: "ok" },
  }), /private|reserved/);
});

test("bounded fetch caps size, redirects and response status", async () => {
  const lookupImpl = async () => ["93.184.216.34"];
  await assert.rejects(() => fetchPublicSource("https://example.com/x", {
    lookupImpl, maxBytes: 4,
    requestImpl: async () => ({ statusCode: 200, headers: {}, body: "12345" }),
  }), /size limit/);
  await assert.rejects(() => fetchPublicSource("https://example.com/x", {
    lookupImpl, maxRedirects: 1,
    requestImpl: async () => ({ statusCode: 302, headers: { location: "https://example.com/y" }, body: "" }),
  }), /too many redirects/);
  await assert.rejects(() => fetchPublicSource("https://example.com/x", {
    lookupImpl, requestImpl: async () => ({ statusCode: 404, headers: {}, body: "" }),
  }), /returned 404/);
  const ok = await fetchPublicSource("https://example.com/x", {
    lookupImpl, requestImpl: async () => ({ statusCode: 200, headers: { "content-type": "text/plain" }, body: "hello" }),
  });
  assert.equal(ok.body, "hello");
});

test("public summary omits private fields and refuses secret query material", () => {
  const job = {
    id: "11111111-1111-4111-8111-111111111111", state: "draft", platform: "x", action: "original",
    topic: "OriginTrail DKG public documentation", createdAt: NOW, updatedAt: NOW,
    targetUrl: null, resultUrl: null, brief: "PRIVATE BRIEF", accountScope: "acct-secret",
    workerId: "worker-secret", provenance: { sources: [{ url: "https://example.com/docs" }] },
  };
  const payload = mirrorPayload(job);
  const text = JSON.stringify(payload);
  for (const secret of ["PRIVATE BRIEF", "acct-secret", "worker-secret", job.id]) assert.equal(text.includes(secret), false);
  assert.throws(() => mirrorPayload({ ...job, provenance: { sources: [{ url: "https://example.com/x?api_key=abc" }] } }), /credential|secret/);
  assert.throws(() => mirrorPayload({ ...job, topic: "secret sk-abcdefghijk12345" }), /credential/);
});

test("subgraph adapter creates, writes and reads back a sanitized summary", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null, method: options.method });
    if (url.includes("/api/sub-graph/create")) return { ok: true, status: 200, text: async () => "{}" };
    if (url.includes("/api/sub-graph/list")) return { ok: true, status: 200, text: async () => JSON.stringify({ subGraphs: [{ name: "scout-jobs" }] }) };
    if (url.includes("/api/knowledge-assets")) return { ok: true, status: 200, text: async () => JSON.stringify({ created: true }) };
    if (url.includes("/api/query")) return { ok: true, status: 200, text: async () => JSON.stringify({ result: { bindings: [{ p: "https://schema.org/name", o: "\"x\"" }] } }) };
    return { ok: false, status: 500, text: async () => "{}" };
  };
  const contextGraphId = "trac-marketing";
  const ensured = await ensureSubGraph({ apiBase: "http://dkg.test", token: "t", contextGraphId, subGraphName: "scout-jobs", fetchImpl });
  assert.equal(ensured.subGraphName, "scout-jobs");
  const payload = mirrorPayload({
    id: "11111111-1111-4111-8111-111111111111", state: "draft", platform: "x", action: "original",
    topic: "OriginTrail DKG public documentation", createdAt: NOW, updatedAt: NOW,
    provenance: { sources: [{ url: "https://example.com/docs" }] },
  });
  await writeSummary({ apiBase: "http://dkg.test", token: "t", contextGraphId, payload, fetchImpl });
  const read = await readbackSummary({ apiBase: "http://dkg.test", token: "t", contextGraphId, subGraphName: "scout-jobs", subject: payload.subject, fetchImpl });
  assert.equal(read.bindings.length, 1);
  const wrote = calls.find((call) => call.url.includes("/api/knowledge-assets"));
  assert.equal(wrote.body.subGraphName, "scout-jobs");
  assert.equal(wrote.body.finalize, false);
  assert.equal(wrote.body.alsoShareSwm, false);
  assert.equal(wrote.body.contextGraphId, "trac-marketing");
  const query = calls.find((call) => call.url.includes("/api/query"));
  assert.equal(query.body.subGraphName, "scout-jobs");
});

test("subgraph create tolerates already-exists and readback failure fails closed", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("create")) return { ok: false, status: 400, text: async () => JSON.stringify({ error: "sub-graph already exists" }) };
    if (url.includes("list")) return { ok: true, status: 200, text: async () => JSON.stringify({ subGraphs: [{ name: "scout-jobs" }] }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: { bindings: [] } }) };
  };
  await ensureSubGraph({ apiBase: "http://dkg.test", token: "t", contextGraphId: "trac-marketing", subGraphName: "scout-jobs", fetchImpl });
  await assert.rejects(() => readbackSummary({ apiBase: "http://dkg.test", token: "t", contextGraphId: "trac-marketing", subGraphName: "scout-jobs", subject: "https://example.com/job/1", fetchImpl }), /no triples/);
});

test("graph mirror is disabled outside live mode or without operator enablement", async () => {
  const cfg = { mode: "dry-run", graph: { contextGraphId: "trac-marketing", subGraphName: "scout-jobs", mirrorEnabled: true } };
  const job = { id: "11111111-1111-4111-8111-111111111111", state: "draft", platform: "x", action: "original", topic: "A public topic", createdAt: NOW, updatedAt: NOW, provenance: { sources: [] } };
  await assert.rejects(() => mirrorJob({ job, config: cfg, apiBase: "http://dkg.test", token: "t", fetchImpl: async () => ({ ok: true }) }), /live mode/);
  await assert.rejects(() => mirrorJob({ job, config: { ...cfg, mode: "live", graph: { ...cfg.graph, mirrorEnabled: false } }, apiBase: "http://dkg.test", token: "t", fetchImpl: async () => ({ ok: true }) }), /disabled/);
});
