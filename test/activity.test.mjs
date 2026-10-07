import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createActivity, trackToolOutcome } from "../activity.mjs";

test("counts all-time installations and calls without exposing identities or counting pings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-activity-"));
  const activity = createActivity(path.join(dir, "activity.sqlite"));
  try {
    const at = Date.now();
    activity.record({ family: "agent-a", tool: "query_graph", graph: "trac-marketing", ok: true, at });
    activity.record({ family: "agent-a", tool: "search_graph", graph: "trac-marketing", ok: true, at });
    activity.record({ family: "agent-b", tool: "write_working_memory", graph: "trac-marketing", ok: false, at });
    activity.record({ family: "agent-old", tool: "query_graph", graph: "trac-marketing", ok: true, at: at - 90000000 });
    activity.record({ family: "idle-client", tool: "ping", graph: "trac-marketing", ok: true, at });
    const snapshot = activity.snapshot(at);
    assert.equal(snapshot.connectedInstallations, 3);
    assert.equal(snapshot.queries, 3);
    assert.equal(snapshot.contributionAttempts, 1);
    assert.equal(snapshot.toolCalls, 4);
    assert.equal(snapshot.successfulToolCalls, 3);
    assert.equal(snapshot.failedToolCalls, 1);
    assert.equal(snapshot.unknownOutcomeCalls, 0);
    assert.equal(snapshot.windows.last24Hours.connectedInstallations, 2);
    assert.equal(snapshot.windows.last7Days.connectedInstallations, 3);
    assert.doesNotMatch(JSON.stringify(snapshot), /agent-a|agent-b/);
  } finally {
    activity.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migration preserves historical flags as unknown and counts current tools", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-activity-"));
  const filename = path.join(dir, "activity.sqlite");
  const at = Date.now();
  const legacy = new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE activity (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, graph TEXT NOT NULL,
    installation TEXT NOT NULL, tool TEXT NOT NULL, ok INTEGER NOT NULL)`);
  legacy.prepare("INSERT INTO activity VALUES(1,?,'trac-marketing','legacy','write_working_memory',1)").run(at);
  legacy.close();
  const activity = createActivity(filename);
  try {
    for (const tool of ["get_posting_context", "list_collective_pushes", "get_network_stats", "write_working_memory"]) {
      activity.record({ family: "current", tool, graph: "trac-marketing", ok: true, at });
    }
    activity.record({ family: "ignored", tool: null, graph: "trac-marketing", ok: false, at });
    const snapshot = activity.snapshot(at);
    assert.equal(snapshot.toolCalls, 5);
    assert.equal(snapshot.queries, 1);
    assert.equal(snapshot.contributionAttempts, 2);
    assert.equal(snapshot.successfulDraftSubmissions, 1);
    assert.equal(snapshot.unknownOutcomeCalls, 1);
    assert.equal(snapshot.successfulToolCalls, 4);
    const oldWriter = new DatabaseSync(filename);
    try {
      oldWriter.prepare("INSERT INTO activity(at,graph,installation,tool,ok) VALUES(?,'trac-marketing','old-writer','query_graph',1)").run(at);
      assert.equal(oldWriter.prepare("SELECT outcome_known FROM activity WHERE installation='old-writer'").get().outcome_known, 0);
    } finally { oldWriter.close(); }
    const check = new DatabaseSync(filename, { readOnly: true });
    try {
      assert.deepEqual({ ...check.prepare("SELECT ok,outcome_known FROM activity WHERE id=1").get() }, { ok: 1, outcome_known: 0 });
    } finally { check.close(); }
  } finally { activity.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("real MCP dispatch tracks success, returned errors, thrown errors and input validation", async () => {
  const auth = new AsyncLocalStorage();
  const server = new McpServer({ name: "activity-test", version: "1" });
  const client = new Client({ name: "activity-test", version: "1" });
  server.registerTool("fixture", { inputSchema: { mode: z.enum(["ok", "returned", "denied", "upstream"]) } },
    trackToolOutcome(auth, async ({ mode }) => {
      if (mode === "denied") throw new Error("Write denied");
      if (mode === "upstream") throw new Error("DKG unavailable");
      return { content: [{ type: "text", text: mode }], ...(mode === "returned" ? { isError: true } : {}) };
    }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    for (const mode of ["ok", "returned", "denied", "upstream", "invalid"]) {
      const context = { toolOk: false };
      const result = await auth.run(context, () => client.callTool({ name: "fixture", arguments: { mode } }));
      assert.equal(result.isError === true, mode !== "ok", mode);
      assert.equal(context.toolOk, mode === "ok", mode);
    }
  } finally { await client.close(); await server.close(); }
});
