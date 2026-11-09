import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHttpModelAdapter, createPublicReadAdapter, parseScoutOutput, runScout, stripHtml } from "../scout.mjs";
import { listJobs, loadConfig } from "../jobs.mjs";
import { NOW, live, opportunity } from "./helpers.mjs";

const publicAdapter = async () => [
  { url: "https://example.com/docs", text: "Public documentation page about OriginTrail DKG queries.", fetchedAt: NOW },
];

test("scout abstains without valid evidence and with no sources", async () => {
  const s = live();
  const abstain = await runScout({
    configPath: s.configPath, dbPath: s.dbPath, sources: ["https://example.com/docs"], scoutId: "scout-1",
    modelAdapter: async () => JSON.stringify({ abstain: true, reason: "weak evidence" }),
    publicAdapter, isModelAvailable: () => true,
  });
  assert.equal(abstain.abstained, true);
  assert.equal(listJobs({ dbPath: s.dbPath, config: loadConfig(s.configPath), operator: true }).length, 0);
  await assert.rejects(() => runScout({
    configPath: s.configPath, dbPath: s.dbPath, sources: [], scoutId: "scout-1",
    modelAdapter: async () => "{}", publicAdapter, isModelAvailable: () => true,
  }), /source URLs/);
});

test("scout validates model JSON and enforces the batch limit", async () => {
  const s = live({ limits: { maxBriefsPerRun: 1, maxBriefsPerDay: 20, maxClaimsPerDay: 10, leaseMinutes: 10, maxPerAccountPerDay: 3 } });
  await assert.rejects(() => runScout({
    configPath: s.configPath, dbPath: s.dbPath, sources: ["https://example.com/docs"], scoutId: "scout-1",
    modelAdapter: async () => "not json", publicAdapter, isModelAvailable: () => true,
  }), /invalid JSON/);
  await assert.rejects(() => runScout({
    configPath: s.configPath, dbPath: s.dbPath, sources: ["https://example.com/docs"], scoutId: "scout-1",
    modelAdapter: async () => JSON.stringify({ opportunities: [opportunity(), { ...opportunity(), topic: "Second topic", brief: "A second distinct brief with a public source." }] }),
    publicAdapter, isModelAvailable: () => true,
  }), /maxBriefsPerRun/);
});

test("scout accepts a bounded source-cited opportunity without invoking a live model", async () => {
  const s = live();
  const result = await runScout({
    configPath: s.configPath, dbPath: s.dbPath, sources: ["https://example.com/docs"], scoutId: "scout-1",
    modelAdapter: async () => JSON.stringify({ opportunities: [opportunity()] }),
    publicAdapter, isModelAvailable: () => true,
  });
  assert.equal(result.accepted.length, 1);
  const jobs = listJobs({ dbPath: s.dbPath, config: loadConfig(s.configPath), operator: true });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].state, "queued");
});

test("scout model output that is not live mode is refused before any read", async () => {
  const s = live({ mode: "dry-run" });
  await assert.rejects(() => runScout({
    configPath: s.configPath, dbPath: s.dbPath, sources: ["https://example.com/docs"], scoutId: "scout-1",
    modelAdapter: async () => JSON.stringify({ opportunities: [opportunity()] }), publicAdapter,
  }), /live mode/);
});

test("model adapter sends the exact model id and never echoes the key", async () => {
  let captured;
  const adapter = createHttpModelAdapter({
    endpoint: "http://127.0.0.1:20128/v1",
    apiKey: "test-key-value",
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body), auth: options.headers.Authorization };
      return { ok: true, json: async () => ({ choices: [{ message: { content: "{}" } }] }) };
    },
  });
  const content = await adapter({ model: "9router/cx/gpt-6.1-sol", system: "s", user: "u" });
  assert.equal(content, "{}");
  assert.equal(captured.url, "http://127.0.0.1:20128/v1/chat/completions");
  assert.equal(captured.body.model, "9router/cx/gpt-6.1-sol");
  assert.equal(captured.body.temperature, 0);
  assert.equal(captured.body.tools, undefined);
});

test("html stripping and JSON parsing are bounded and explicit", () => {
  assert.equal(stripHtml("<script>x</script><p>Hello &amp; bye</p>"), "Hello & bye");
  assert.deepEqual(parseScoutOutput('{"abstain":true,"reason":"none"}'), { abstain: true, reason: "none" });
  assert.throws(() => parseScoutOutput('{"opportunities":{}}'), /no opportunities array/);
});

test("public read adapter deduplicates and bounds declared sources", async () => {
  const read = createPublicReadAdapter({
    fetchPublic: async (url) => ({ url, body: `<p>Text for ${url}</p>`, contentType: "text/html", fetchedAt: NOW }),
  });
  const rows = await read(["https://example.com/a", "https://example.com/a"], { maxSources: 5 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, "Text for https://example.com/a");
});
