import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAssets, classifyPost, createWatcher, extractOperationId, extractScriptUrls, hasQueryContent, isSharedAsset, isWorkingAsset, normalizeXHandle, openStore, shouldNotifyPost, shouldSkipPost } from "../watcher.mjs";

test("X handles are required, validated, and normalized", () => {
  assert.equal(normalizeXHandle(" @Origin_Trail "), "Origin_Trail");
  assert.equal(normalizeXHandle("Origin_Trail", true), "@Origin_Trail");
  for (const handle of ["", "@", "two words", "sixteen_chars____", "name.example"]) {
    assert.throws(() => normalizeXHandle(handle), /X handle must be/);
  }
});

test("current X bundle metadata can be discovered without fixed asset hashes", () => {
  const html = `<script src="https://abs.twimg.com/responsive-web/client-web/main.abc123.js"></script>
    <link rel="preload" as="script" href="https://abs.twimg.com/responsive-web/client-web/main.abc123.js">
    <script src="https://example.com/ignored.js"></script>`;
  assert.deepEqual(extractScriptUrls(html), ["https://abs.twimg.com/responsive-web/client-web/main.abc123.js"]);
  assert.equal(extractOperationId('e.exports={queryId:"current-id",operationName:"SearchTimeline",operationType:"query"}', "SearchTimeline"), "current-id");
  assert.equal(extractOperationId('e.exports={queryId:"wrong-id",operationName:"ListSearchTimeline",operationType:"query"}', "SearchTimeline"), "");
});

test("member activity bypasses public reply and repost noise filters", () => {
  assert.equal(shouldSkipPost({ isReply: true, isRt: false }, "swarm-member", true, true), false);
  assert.equal(shouldSkipPost({ isReply: false, isRt: true }, "approved-writer", true, true), false);
  assert.equal(shouldSkipPost({ isReply: true, isRt: false }, "discovery", true, true), true);
  assert.equal(shouldSkipPost({ isReply: false, isRt: true }, "ecosystem-account", true, true), true);
});

test("amplification webhooks only notify for original posts", () => {
  assert.equal(shouldNotifyPost({ isReply: false, isRt: false }), true);
  assert.equal(shouldNotifyPost({ isReply: true, isRt: false }), false);
  assert.equal(shouldNotifyPost({ isReply: false, isRt: true }), false);
});

test("watcher reads additional accounts dynamically and deduplicates by case", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-accounts-"));
  const previous = {
    WATCH_DB: process.env.WATCH_DB,
    WATCH_SEEN: process.env.WATCH_SEEN,
    WATCH_DETECTIONS: process.env.WATCH_DETECTIONS,
  };
  process.env.WATCH_DB = path.join(directory, "watcher.sqlite");
  process.env.WATCH_SEEN = path.join(directory, "seen.json");
  process.env.WATCH_DETECTIONS = path.join(directory, "detections.jsonl");
  let additional = ["@AgentOne", "agentone", "bad handle"];
  const watcher = createWatcher({ fanout: async () => ({}), getAdditionalAccounts: () => additional });
  assert.ok(watcher.status().monitoredAccounts.includes("AgentOne"));
  assert.equal(watcher.status().monitoredAccounts.filter((item) => item.toLowerCase() === "agentone").length, 1);
  additional = [];
  assert.ok(!watcher.status().monitoredAccounts.some((item) => item.toLowerCase() === "agentone"));
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

test("official posts are primary-source ecosystem observations", () => {
  const result = classifyPost({ account: "@origin_trail", summary: "New release" }, ["origin_trail"]);
  assert.equal(result.relevant, true);
  assert.equal(result.category, "official-announcement");
  assert.equal(result.evidenceLevel, "primary-source-self-report");
});

test("bare ambiguous keywords do not pass classification", () => {
  for (const summary of ["TRAC meeting starts at noon", "generic DKG package update", "#DKGSwarm #TRAC"]) {
    const result = classifyPost({ account: "@someone", summary }, ["origin_trail"]);
    assert.equal(result.relevant, false);
    assert.equal(result.rejectionReason, "ambiguous-keyword-only");
  }
});

test("approved writers and registered members are collected without marker text", () => {
  const writer = classifyPost({ account: "@writer", summary: "A normal public update" }, ["origin_trail"], { sourceTier: "approved-writer" });
  assert.equal(writer.relevant, true);
  assert.equal(writer.category, "approved-writer-post");
  assert.equal(writer.score, 85);

  const member = classifyPost({ account: "@member", summary: "A useful reply in my own voice" }, ["origin_trail"], { sourceTier: "swarm-member" });
  assert.equal(member.relevant, true);
  assert.equal(member.category, "swarm-member-post");
  assert.equal(member.score, 75);
});

test("broader ecosystem and adoption vocabulary passes contextual discovery", () => {
  for (const summary of [
    "NeuroWeb knowledge mining gives AI access to verifiable knowledge assets",
    "OriginTrail supports GS1 supply chain provenance and digital product passports",
    "Paranets organize Knowledge Assets for decentralized AI",
  ]) {
    const result = classifyPost({ account: "@someone", summary }, ["origin_trail"], { sourceTier: "discovery", searchTier: 3 });
    assert.equal(result.relevant, true);
    assert.equal(result.category, "ecosystem-signal");
    assert.ok(result.score >= 35);
  }
});

test("thin discovery and bare ticker posts stay out of WM queue", () => {
  for (const summary of ["$TRAC", "$TRAC to the moon, buy now!", "@origin_trail #AI", "TRAC price target $1"] ) {
    const result = classifyPost({ account: "@unknown", summary }, ["origin_trail"], { sourceTier: "discovery" });
    assert.equal(result.relevant, false);
  }
});

test("strong ecosystem evidence and relationships are extracted", () => {
  const result = classifyPost({
    account: "@someone",
    summary: "OriginTrail DKG V10 with @origin_trail #VerifiableWeb https://example.com/post",
  }, ["origin_trail"]);
  assert.equal(result.relevant, true);
  assert.equal(result.category, "ecosystem-signal");
  assert.deepEqual(result.relationships.mentions, ["@origin_trail"]);
  assert.deepEqual(result.relationships.hashtags, ["#VerifiableWeb"]);
  assert.deepEqual(result.relationships.links, ["https://example.com/post"]);
});

test("raw and derived assets have stable separate identities", () => {
  const post = {
    post_id: "123", account: "@origin_trail", post_url: "https://x.com/origin_trail/status/123",
    summary: "OriginTrail update", created_at: "Thu Sep 17 00:00:00 +0000 2026",
  };
  const classification = classifyPost(post, ["origin_trail"]);
  const assets = buildAssets(post, classification, "2026-09-17T00:00:00.000Z");
  assert.equal(assets.raw.name, "raw-x-post-123");
  assert.equal(assets.derived.name, "x-insight-123");
  assert.ok(assets.raw.quads.some((quad) => quad.predicate === "https://schema.org/articleBody"));
  assert.ok(assets.derived.quads.some((quad) => quad.predicate === `${"https://www.dkgswarm.com/ontology/x/"}evidenceLevel`));
  assert.ok(assets.derived.quads.some((quad) => quad.predicate === `${"https://www.dkgswarm.com/ontology/x/"}sourceTier`));
  assert.ok(assets.derived.quads.some((quad) => quad.predicate === `${"https://www.dkgswarm.com/ontology/x/"}score`));
  assert.ok(!assets.derived.quads.some((quad) => quad.predicate === "https://schema.org/articleBody"));
});

test("only confirmed SWM response shapes count as shared", () => {
  assert.equal(isSharedAsset({ status: "swm-shared", swmShared: true }), true);
  assert.equal(isSharedAsset({ swmShared: true, promotedCount: 8 }), true);
  assert.equal(isSharedAsset({ memoryLayer: "SWM", state: "promoted" }), true);
  assert.equal(isSharedAsset({ status: "wm-sealed", memoryLayer: "WM", state: "created" }), false);
  assert.equal(isSharedAsset({ written: 8 }), false);
  assert.equal(isSharedAsset({}), false);
});

test("WM draft responses count as written without implying SWM share", () => {
  assert.equal(isWorkingAsset({ memoryLayer: "WM", state: "created" }), true);
  assert.equal(isWorkingAsset({ written: 8 }), true);
  assert.equal(isSharedAsset({ memoryLayer: "WM", state: "created" }), false);
});

test("only non-empty SPARQL results confirm durable content", () => {
  assert.equal(hasQueryContent({ result: { type: "boolean", value: true } }), true);
  assert.equal(hasQueryContent({ result: { type: "boolean", boolean: true } }), true);
  assert.equal(hasQueryContent({ result: { type: "boolean", value: false } }), false);
  assert.equal(hasQueryContent({ result: { type: "boolean", boolean: false } }), false);
  assert.equal(hasQueryContent({ result: { type: "bindings", bindings: [{ s: "urn:item" }] } }), true);
  assert.equal(hasQueryContent({ result: { type: "bindings", bindings: [] } }), false);
  assert.equal(hasQueryContent({}), false);
});

test("legacy seen state migrates without replaying completed webhooks", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-"));
  const seenPath = path.join(directory, "seen.json");
  const detectionsPath = path.join(directory, "detections.jsonl");
  fs.writeFileSync(seenPath, JSON.stringify({
    ids: { "123": { at: "2026-09-17T00:00:00.000Z", account: "@origin_trail", kind: "official" } },
    seededAccounts: { origin_trail: true },
  }));
  const db = openStore(path.join(directory, "watcher.sqlite"), seenPath, detectionsPath);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM observations").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'skipped'").get().count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM seeded_accounts").get().count, 1);
  const assets = db.prepare("SELECT raw_asset, insight_asset FROM observations WHERE post_id = '123'").get();
  assert.equal(assets.raw_asset, "raw-x-post-123");
  assert.equal(assets.insight_asset, "x-insight-123");
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("legacy pending collective pushes cannot retry into SWM", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-legacy-"));
  const filename = path.join(directory, "watcher.sqlite");
  const db = openStore(filename, path.join(directory, "missing.json"), path.join(directory, "missing.jsonl"));
  db.prepare(`INSERT INTO observations (post_id, account, kind, post_url, summary, observed_at, classification_json)
    VALUES ('123', '@origin_trail', 'official', 'https://x.com/i/status/123', 'test', '2026-09-23T00:00:00Z', '{}')`).run();
  db.prepare(`INSERT INTO deliveries (post_id, stage, next_attempt_at) VALUES ('123', 'collective-push-dkg', '2026-09-23T00:00:00Z')`).run();
  db.close();
  const reopened = openStore(filename, path.join(directory, "missing.json"), path.join(directory, "missing.jsonl"));
  assert.equal(reopened.prepare("SELECT status FROM deliveries WHERE stage = 'collective-push-dkg'").get().status, "skipped");
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
