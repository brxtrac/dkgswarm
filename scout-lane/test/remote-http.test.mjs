import test from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createStore, randomToken } from "../../oauth.mjs";
import { createOAuthProvider } from "../../oauth-provider.mjs";
import { createScoutTools } from "../remote.mjs";
import { loadConfig } from "../jobs.mjs";
import { opportunity, setup } from "./helpers.mjs";

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

test("real HTTP MCP path uses OAuth token family and revokes immediately", async () => {
  const s = setup({ mode: "dry-run" });
  const store = createStore([], join(s.dir, "oauth.json"));
  const authStore = new AsyncLocalStorage();
  const app = express();
  app.use(express.json());
  let provider;
  let server;
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => listener.once("listening", resolve));
  const port = listener.address().port;
  const mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  provider = createOAuthProvider({ store, mcpUrl, writerCredentialsActive: () => true });

  app.use("/mcp", async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    try {
      const auth = await provider.verifyAccessToken(token);
      authStore.run({ scopes: auth.scopes, family: auth.tokenFamilyId }, () => next());
    } catch {
      res.status(401).json({ error: "unauthorized" });
    }
  });
  app.post("/mcp", async (req, res) => {
    server = new McpServer({ name: "scout-http-test", version: "1.0.0" });
    for (const tool of createScoutTools({
      getAuth: () => authStore.getStore(), query: async () => [], json,
      configPath: s.configPath, capabilitiesPath: s.statusesPath, dbPath: s.dbPath,
    })) server.registerTool(tool.name, tool.definition, tool.handler);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const token = randomToken();
  store.putToken(token, {
    type: "access", clientId: "http-test", scopes: ["dkg:read"],
    resource: mcpUrl.href, tokenFamilyId: "fam-http", expiresAt: Date.now() + 3600_000,
  });
  writeFileSync(s.statusesPath, JSON.stringify({ version: 1, grants: [
    { id: "worker-http", tokenFamily: "fam-http", roles: ["scout", "worker", "operator"], accounts: ["acct-1"] },
  ] }));

  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.some((tool) => tool.name === "scout_jobs_list"), true);
  const queued = await client.callTool({ name: "scout_job_enqueue", arguments: { opportunities: [opportunity()] } });
  assert.equal(JSON.parse(queued.content[0].text).accepted.length, 1);
  const claimed = JSON.parse((await client.callTool({ name: "scout_job_claim", arguments: {} })).content[0].text);
  assert.equal(claimed.claimed, true);
  const drafted = JSON.parse((await client.callTool({
    name: "scout_job_report",
    arguments: { jobId: claimed.job.id, fencingToken: claimed.fencingToken, revision: claimed.revision, status: "drafted", content: "A short HTTP lifecycle draft with a public source." },
  })).content[0].text);
  assert.equal(drafted.ok, true);
  const listed = await client.callTool({ name: "scout_jobs_list", arguments: {} });
  assert.equal(JSON.parse(listed.content[0].text).jobs[0].state, "draft");

  writeFileSync(s.statusesPath, JSON.stringify({ version: 1, grants: [] }));
  const revoked = await client.callTool({ name: "scout_jobs_list", arguments: {} });
  assert.equal(revoked.isError, true);
  assert.match(revoked.content[0].text, /no scout capability grant/);

  store.deleteToken(token);
  await assert.rejects(() => client.callTool({ name: "scout_jobs_list", arguments: {} }), /401|unauthorized|Unauthorized/i);
  await client.close();
  await new Promise((resolve) => listener.close(resolve));
  assert.equal(loadConfig(s.configPath).mode, "dry-run");
});
