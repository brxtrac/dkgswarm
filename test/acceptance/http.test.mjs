import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startStack } from "../fixtures/stack.mjs";

test("real MCP transport preserves reader boundaries and records semantic outcomes", async (t) => {
  const stack = await startStack();
  t.after(() => stack.close());
  const client = new Client({ name: "acceptance", version: "1" });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${stack.base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${stack.readerToken}` } } }));
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 9);
  const resources = await client.listResources();
  const prompts = await client.listPrompts();
  assert.equal(resources.resources.length, 1);
  assert.equal(prompts.prompts.length, 1);
  const info = await client.callTool({ name: "graph_info", arguments: {} });
  assert.equal(JSON.parse(info.content[0].text).access, "reader");
  const read = await client.callTool({ name: "query_graph", arguments: { sparql: "SELECT ?s ?o WHERE { ?s <http://www.w3.org/2000/01/rdf-schema#comment> ?o } LIMIT 2" } });
  assert.equal(read.isError, undefined);
  assert.equal(JSON.parse(read.content[0].text).result.result.bindings.length, 2);
  const privateQuery = await client.callTool({ name: "query_graph", arguments: { sparql: "ASK { ?s ?p ?o }", view: "working-memory" } });
  assert.equal(privateQuery.isError, true);
  assert.equal(stack.requests.filter(row => row.view === "working-memory").length, 0);
  const denied = await client.callTool({ name: "write_working_memory", arguments: { name: "reader-draft", text: "must be denied" } });
  assert.equal(denied.isError, true);
  const invalid = await client.callTool({ name: "write_working_memory", arguments: {} });
  assert.equal(invalid.isError, true);
  stack.setUnavailable(true);
  const failedRead = await client.callTool({ name: "query_graph", arguments: { sparql: "ASK { ?s ?p ?o }" } });
  assert.equal(failedRead.isError, true);
  stack.setUnavailable(false);
  const db = new DatabaseSync(stack.activityFile, { readOnly: true });
  try {
    const writes = db.prepare("SELECT ok FROM activity WHERE tool = 'write_working_memory' ORDER BY id").all();
    assert.deepEqual(writes.map(row => row.ok), [0, 0]);
    assert.equal(db.prepare("SELECT ok FROM activity WHERE tool = 'query_graph' ORDER BY id DESC LIMIT 1").get().ok, 0);
  } finally { db.close(); }
  assert.equal(stack.requests.filter(row => row.route === "/api/knowledge-assets").length, 0);
  const policy = await client.callTool({ name: "get_swarm_policy", arguments: {} });
  assert.equal(JSON.parse(policy.content[0].text).policy.version, 1);

  const enabled = await client.callTool({ name: "enable_writer_access", arguments: { oneTimeCode: stack.writerCode } });
  assert.equal(JSON.parse(enabled.content[0].text).access, "writer");
  const draft = await client.callTool({ name: "write_working_memory", arguments: { name: "approved-draft", text: "A private approved draft", sourceUrl: "https://source.example/draft" } });
  assert.equal(draft.isError, undefined);
  assert.equal(JSON.parse(draft.content[0].text).curatorReview, "queued");
  const request = stack.requests.find(row => row.route === "/api/knowledge-assets");
  assert.equal(request.finalize, false);
  assert.equal(request.alsoShareSwm, false);
  assert.ok(request.quads.some(row => row.predicate === "https://schema.org/dateCreated"));
  const intake = new DatabaseSync(`${stack.directory}/curator-intake.sqlite`, { readOnly: true });
  try { assert.equal(intake.prepare("SELECT name FROM drafts WHERE reviewed_at IS NULL").get().name, "approved-draft"); }
  finally { intake.close(); }
  const stillDenied = await client.callTool({ name: "share_to_swm", arguments: { name: "approved-draft" } });
  assert.equal(stillDenied.isError, true);
  const publicRead = await (await fetch(`${stack.base}/api/swarm/memory?q=private`)).json();
  assert.equal(publicRead.entries.length, 0);
  const stats = await (await fetch(`${stack.base}/api/swarm/stats`)).json();
  assert.equal(stats.contributionAttempts, 3);
  assert.equal(stats.successfulDraftSubmissions, 1);
  assert.ok(stats.failedToolCalls >= 3);
});

test("fresh reader OAuth uses PKCE and refresh cannot escalate scopes", async (t) => {
  const stack = await startStack();
  t.after(() => stack.close());
  const redirect = `${stack.base}/fixture-callback`;
  const registration = await fetch(`${stack.base}/register`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "local acceptance", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none" }) });
  assert.equal(registration.status, 201);
  const registered = await registration.json();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({ client_id: registered.client_id, redirect_uri: redirect, response_type: "code",
    code_challenge: challenge, code_challenge_method: "S256", scope: "dkg:read", resource: `${stack.base}/mcp`, state: "local-state" });
  const authorization = await fetch(`${stack.base}/authorize?${params}`, { redirect: "manual" });
  assert.equal(authorization.status, 302);
  const callback = new URL(authorization.headers.get("location"));
  assert.equal(callback.searchParams.get("state"), "local-state");
  const code = callback.searchParams.get("code");
  const exchange = body => fetch(`${stack.base}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: registered.client_id, ...body }) });
  const wrongVerifier = await exchange({ grant_type: "authorization_code", code, code_verifier: "wrong".repeat(10), redirect_uri: redirect });
  assert.equal(wrongVerifier.ok, false);
  const response = await exchange({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirect });
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal(tokens.scope, "dkg:read");
  const escalation = await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, scope: "dkg:read dkg:write" });
  assert.equal(escalation.ok, false);
  const refreshed = await exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, scope: "dkg:read" });
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json();
  assert.equal(next.scope, "dkg:read");
  const client = new Client({ name: "fresh-reader", version: "1" });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${stack.base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${next.access_token}` } } }));
  const info = await client.callTool({ name: "graph_info", arguments: {} });
  assert.equal(JSON.parse(info.content[0].text).access, "reader");
});

test("memory search and filters execute against the official DKG RDF adapter", async (t) => {
  const stack = await startStack();
  t.after(() => stack.close());
  const page = await (await fetch(`${stack.base}/api/swarm/memory`)).json();
  assert.equal(page.entries.length, 80);
  assert.equal(page.nextOffset, 80);
  assert.ok(!page.entries.some(entry => entry.id.endsWith("entry-000")));
  const search = await (await fetch(`${stack.base}/api/swarm/memory?q=needle&source=source.example&from=2026-09-01&to=2026-09-01`)).json();
  assert.equal(search.entries.length, 1);
  assert.equal(search.entries[0].id, "https://www.dkgswarm.com/ka/entry-000");
  assert.equal(search.entries[0].createdAt, "2026-09-01T12:00:00Z");
  assert.equal(search.nextOffset, null);
  const injection = await (await fetch(`${stack.base}/api/swarm/memory?q=${encodeURIComponent('")) } UNION { ?s ?p ?o } #')}`)).json();
  assert.equal(injection.entries.length, 0);
  for (const query of ["from=2026-02-30", "from=2026-10-01&to=2026-09-01", "offset=10001", `q=${"a".repeat(201)}`]) {
    assert.equal((await fetch(`${stack.base}/api/swarm/memory?${query}`)).status, 400);
  }
});

test("both stats services preserve all legacy fields and protect operational health", async (t) => {
  const stack = await startStack({ collector: true });
  t.after(() => stack.close());
  const rootStats = await (await fetch(`${stack.base}/api/swarm/stats`)).json();
  const collectorStats = await (await fetch(`${stack.collectorUrl}/api/swarm/stats`)).json();
  for (const stats of [rootStats, collectorStats]) {
    assert.equal(stats.collectedSources, 1);
    assert.equal(stats.sharedPosts, 1);
    assert.equal(stats.toolCalls, 0);
    assert.equal(stats.connectedInstallations, 0);
    assert.equal(stats.windows.last24Hours.failedToolCalls, 0);
    assert.deepEqual(stats.availability, { usage: "available", collection: "available", sharedMemory: "available" });
    assert.equal(stats.queueHealth, undefined);
    assert.equal(stats.curator, undefined);
    assert.doesNotMatch(JSON.stringify(stats), /synthetic|fixture-family|fixture rejection/);
  }
  assert.deepEqual(Object.keys(rootStats).sort(), Object.keys(collectorStats).sort());
  assert.equal((await fetch(`${stack.collectorUrl}/api/swarm/watcher`)).status, 401);
  const response = await fetch(`${stack.collectorUrl}/api/swarm/watcher`, { headers: { "X-Swarm-Admin": "synthetic-admin" } });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const health = await response.json();
  assert.equal(health.queueHealth.pendingDeliveries, 1);
  assert.equal(health.queueHealth.failedAttempts, 2);
  assert.ok(health.queueHealth.oldestPendingAgeMs > 0);
  assert.deepEqual(health.curator.decisions, [{ status: "promoted", count: 1 }, { status: "rejected", count: 1 }]);
});

test("unavailable shared memory preserves each service's existing HTTP behavior", async (t) => {
  const stack = await startStack({ collector: true });
  t.after(() => stack.close());
  stack.setUnavailable(true);
  const root = await fetch(`${stack.base}/api/swarm/stats`);
  assert.equal(root.status, 200);
  const partial = await root.json();
  assert.equal(partial.toolCalls, 0);
  assert.equal(partial.sharedPosts, null);
  assert.equal(partial.availability.sharedMemory, "unavailable");
  const collector = await fetch(`${stack.collectorUrl}/api/swarm/stats`);
  assert.equal(collector.status, 503);
  const missing = await collector.json();
  assert.equal(missing.error, "Swarm stats temporarily unavailable");
  assert.equal(missing.sharedPosts, null);
  assert.equal(missing.collectedSources, 1);
});
