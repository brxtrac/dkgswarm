import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAssets, buildTrustedPush, classifyPost, createWatcher, dkgHealth, extractOperationId, extractScriptUrls, hasQueryContent, matchesDerivedQuads, isSharedAsset, isWorkingAsset, normalizeXHandle, openStore, shouldNotifyPost, shouldSkipPost, trustedPushEligible } from "../watcher.mjs";

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

test("trusted direct push accepts only verified allowlisted originals and quotes within source window", () => {
  const created = "2026-09-29T12:00:00.000Z";
  const post = { post_id: "123456789", account: "@DrevZiga", post_url: "https://x.com/DrevZiga/status/123456789",
    summary: "A new post", created_at: created, authorVerified: true, isReply: false, isRt: false };
  const at = Date.parse(created) + 29 * 60000;
  for (const account of ["DrevZiga", "BranaRakic", "umanitek", "origin_trail"]) {
    assert.equal(trustedPushEligible({ ...post, account: `@${account}`, post_url: `https://x.com/${account}/status/123456789` }, at), true);
  }
  assert.equal(trustedPushEligible(post, at), true);
  assert.equal(trustedPushEligible({ ...post, isQuote: true }, at), true);
  for (const change of [{ account: "@CredibleCrypto" }, { isReply: true }, { isRt: true },
    { authorVerified: false }, { created_at: "" }, { post_url: "https://x.com/other/status/123456789" }]) {
    assert.equal(trustedPushEligible({ ...post, ...change }, at), false);
  }
  assert.equal(trustedPushEligible(post, at + 60000), false);
  assert.equal(trustedPushEligible(post, Date.parse(created) - 1), false);
  assert.equal(trustedPushEligible(post, Date.parse(created)), true);
  const push = buildTrustedPush(post);
  assert.equal(push.name, "collective-push-x-123456789");
  assert.equal(push.subject, "https://www.dkgswarm.com/ka/collective-push-x-123456789");
  assert.equal(push.target, "https://x.com/i/status/123456789");
  assert.equal(push.expiresAt, "2026-09-29T12:30:00.000Z");
  assert.ok(push.quads.some((quad) => quad.predicate === "https://www.dkgswarm.com/ontology/curator/targetPost" && quad.object === push.target));
});

test("trusted push rejects future source timestamps", () => {
  const post = { post_id: "123456789", account: "@DrevZiga", post_url: "https://x.com/DrevZiga/status/123456789",
    summary: "New post", created_at: new Date(Date.now() + 1000).toISOString(), authorVerified: true, isReply: false, isRt: false };
  assert.equal(trustedPushEligible(post), false);
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
  assert.ok(watcher.status().monitoredAccounts.includes("origintraildev"));
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

test("support-account posts stay out unless they name OriginTrail, Umanitek, or TRAC", () => {
  const off = classifyPost(
    { account: "@CredibleCrypto", summary: "Bitcoin funding rates look stretched after this weekend move." },
    ["origin_trail", "origintraildev", "umanitek"],
    { sourceTier: "ecosystem-account" },
  );
  assert.equal(off.relevant, false);
  assert.equal(off.rejectionReason, "off-topic-support");
  for (const summary of [
    "OriginTrail knowledge assets showed up in a supply-chain pilot.",
    "$TRAC staking range is on the dashboard again.",
    "Umanitek published a note on verifiable AI.",
  ]) {
    const on = classifyPost(
      { account: "@CredibleCrypto", summary },
      ["origin_trail", "origintraildev", "umanitek"],
      { sourceTier: "ecosystem-account" },
    );
    assert.equal(on.relevant, true, summary);
    assert.equal(on.category, "ecosystem-signal");
  }
  const official = classifyPost(
    { account: "@origin_trail", summary: "Office closed Friday." },
    ["origin_trail", "origintraildev", "umanitek"],
  );
  assert.equal(official.relevant, true);
  assert.equal(official.category, "official-announcement");
});

test("official posts are primary-source ecosystem observations", () => {
  const dev = classifyPost({ account: "@origintraildev", summary: "New release" }, ["origin_trail", "origintraildev", "umanitek"]);
  assert.equal(dev.category, "official-announcement");
  assert.equal(dev.sourceTier, "official");
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

test("first seed queues fresh verified trusted pushes without historical WM; restart prioritizes trusted delivery", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-trusted-"));
  const keys = ["WATCH_DB", "WATCH_SEEN", "WATCH_DETECTIONS", "DKG_API_TOKEN_FILE", "WATCH_SUPPORT_ACCOUNTS", "WATCH_X_AUTH_TOKEN", "WATCH_X_CT0", "WATCH_RETRY_MS"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const dbPath = path.join(directory, "watcher.sqlite");
  process.env.WATCH_DB = dbPath;
  process.env.WATCH_SEEN = path.join(directory, "seen.json");
  process.env.WATCH_DETECTIONS = path.join(directory, "detections.jsonl");
  process.env.DKG_API_TOKEN_FILE = path.join(directory, "token");
  process.env.WATCH_SUPPORT_ACCOUNTS = "";
  delete process.env.WATCH_X_AUTH_TOKEN;
  delete process.env.WATCH_X_CT0;
  process.env.WATCH_RETRY_MS = "20";
  fs.writeFileSync(process.env.DKG_API_TOKEN_FILE, "test-token");
  let currentId = "123456789012345678";
  const oldId = "123456789012345677";
  const requests = [];
  const written = new Set();
  const shared = new Set();
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
  const result = (id, createdAt, screen = "DrevZiga", uid = "42") => ({ rest_id: id,
    legacy: { full_text: "New update", created_at: createdAt },
    core: { user_results: { result: { rest_id: uid, legacy: { screen_name: screen } } } } });
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith("/guest/activate.json")) return json({ guest_token: "guest" });
    if (url.includes("/UserByScreenName")) {
      const screen = JSON.parse(new URL(url).searchParams.get("variables")).screen_name;
      return json({ data: { user: { result: { rest_id: screen === "DrevZiga" ? "42" : "99" } } } });
    }
    if (url.includes("/UserTweets")) {
      const uid = JSON.parse(new URL(url).searchParams.get("variables")).userId;
      const entries = uid === "42" ? [result(oldId, new Date(Date.now() - 3600000).toUTCString()),
        result(currentId, new Date(Date.now() - 60000).toUTCString()),
        result("123456789012345680", new Date().toUTCString(), "Impostor"),
        result("123456789012345681", new Date().toUTCString(), "DrevZiga", "99"),
        { ...result("123456789012345682", new Date().toUTCString()), core: {} }] : [];
      return json({ data: { user: { result: { timeline_v2: { timeline: { instructions: [{ entries: entries.map((tweet) =>
        ({ content: { itemContent: { tweet_results: { result: tweet } } } })) }] } } } } } });
    }
    if (url.endsWith("/api/knowledge-assets")) {
      const name = JSON.parse(options.body).name;
      requests.push(name);
      written.add(name);
      return json({ memoryLayer: "WM" });
    }
    if (url.includes("/swm/share")) {
      const name = url.split("/knowledge-assets/")[1].split("/")[0];
      assert.ok(trustedPushEligible({ post_id: currentId, account: "@DrevZiga",
        post_url: `https://x.com/DrevZiga/status/${currentId}`, summary: "New update",
        created_at: new Date(Date.now() - 60000).toUTCString(), authorVerified: true, isReply: false, isRt: false }));
      shared.add(name);
      return json({ swmShared: true });
    }
    if (url.includes("/api/knowledge-assets/")) {
      const name = url.split("/knowledge-assets/")[1].split("?")[0];
      return written.has(name) ? json({ assertionGraph: `did:dkg:context-graph:${name}` }) : json({}, 404);
    }
    if (url.endsWith("/api/query")) {
      const body = JSON.parse(options.body);
       assert.doesNotMatch(body.sparql, /GRAPH\s*</);
       const id = body.sparql.match(/(?:classification\/|status\/)(\d+)|collective-push-x-(\d+)/)?.slice(1).find(Boolean);
       const name = body.sparql.includes("SocialMediaPosting") ? `raw-x-post-${id}`
         : body.sparql.includes("Classification") ? `x-insight-${id}` : `collective-push-x-${id}`;
       return json({ result: { type: "boolean", value: body.view === "shared-working-memory" ? shared.has(name) : written.has(name) } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const waitFor = async (condition) => {
    for (let i = 0; i < 200; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("watcher did not finish polling");
  };
  try {
    const first = createWatcher({ log: { info() {}, error() {} } });
    first.start();
    await waitFor(() => first.status().lastPoll && first.status().queue.some((row) => row.stage === "trusted-push-dkg" && row.status === "completed"));
    const db = openStore(dbPath, process.env.WATCH_SEEN, process.env.WATCH_DETECTIONS);
    assert.deepEqual(db.prepare("SELECT post_id FROM deliveries WHERE stage IN ('raw-dkg', 'derived-dkg')").all(), []);
    assert.deepEqual(db.prepare("SELECT post_id FROM deliveries WHERE stage = 'trusted-push-dkg'").all().map((row) => row.post_id), ["123456789012345678"]);
    currentId = "123456789012345679";
    const fresh = { post_id: currentId, account: "@DrevZiga", post_url: `https://x.com/DrevZiga/status/${currentId}`,
      summary: "New update", created_at: new Date(Date.now() - 60000).toUTCString(), authorVerified: true, isReply: false, isRt: false };
    db.prepare(`INSERT INTO observations (post_id, account, kind, post_url, summary, created_at, author_verified, observed_at, classification_json)
      VALUES (?, ?, 'official', ?, ?, ?, 1, ?, ?)`).run(currentId, fresh.account, fresh.post_url, fresh.summary,
        fresh.created_at, new Date().toISOString(), JSON.stringify(classifyPost(fresh, [], { sourceTier: "approved-writer" })));
    db.prepare("INSERT INTO deliveries (post_id, stage, next_attempt_at) VALUES (?, 'trusted-push-dkg', ?)")
      .run(currentId, new Date().toISOString());
    for (let i = 0; i < 30; i++) {
      const id = String(200000000000000000n + BigInt(i));
      db.prepare(`INSERT INTO observations (post_id, account, kind, post_url, summary, observed_at, classification_json)
        VALUES (?, '@someone', 'official', '', 'old', ?, ?)`).run(id, new Date().toISOString(),
          JSON.stringify(classifyPost({ account: "@someone", summary: "old" })));
      db.prepare("INSERT INTO deliveries (post_id, stage, next_attempt_at) VALUES (?, 'raw-dkg', ?)")
        .run(id, new Date(Date.now() - 10000).toISOString());
    }
    db.close();
    requests.length = 0;
    const restarted = createWatcher({ log: { info() {}, error() {} } });
    restarted.start();
    await waitFor(() => restarted.status().queue.some((row) => row.stage === "trusted-push-dkg" && row.status === "completed" && row.count === 2));
    assert.equal(requests[0], `collective-push-x-${currentId}`);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("trusted account pagination collects posts beyond first 12 with bounded requests", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-pages-"));
  const keys = ["WATCH_DB", "WATCH_SEEN", "WATCH_DETECTIONS", "WATCH_SUPPORT_ACCOUNTS", "WATCH_X_AUTH_TOKEN", "WATCH_X_CT0"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.WATCH_DB = path.join(directory, "watcher.sqlite");
  process.env.WATCH_SEEN = path.join(directory, "seen.json");
  process.env.WATCH_DETECTIONS = path.join(directory, "detections.jsonl");
  process.env.WATCH_SUPPORT_ACCOUNTS = "";
  delete process.env.WATCH_X_AUTH_TOKEN;
  delete process.env.WATCH_X_CT0;
  const cursors = [];
  const json = (body) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/guest/activate.json")) return json({ guest_token: "guest" });
    if (url.includes("/UserByScreenName")) return json({ data: { user: { result: { rest_id: JSON.parse(new URL(url).searchParams.get("variables")).screen_name === "DrevZiga" ? "42" : "99" } } } });
    if (url.includes("/UserTweets")) {
      const { userId, cursor } = JSON.parse(new URL(url).searchParams.get("variables"));
      if (userId !== "42") return json({ data: { user: { result: { timeline_v2: { timeline: { instructions: [] } } } } } });
      cursors.push(cursor || "");
      const start = cursor ? 13 : 1;
      const entries = Array.from({ length: 12 }, (_, index) => {
        const id = String(123456789000000000n + BigInt(start + index));
        return { content: { itemContent: { tweet_results: { result: { rest_id: id,
          legacy: { full_text: "Normal post", created_at: new Date(Date.now() - 60000).toUTCString() },
          core: { user_results: { result: { rest_id: "42", legacy: { screen_name: "DrevZiga" } } } } } } } } };
      });
      entries.push({ content: { cursorType: "Bottom", value: "repeat-cursor" } });
      return json({ data: { user: { result: { timeline_v2: { timeline: { instructions: [{ entries }] } } } } } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const watcher = createWatcher({ log: { info() {}, error() {} } });
    watcher.start();
    for (let i = 0; i < 200 && !watcher.status().lastPoll; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(watcher.status().lastPoll);
    assert.deepEqual(cursors, ["", "repeat-cursor"]);
    assert.equal(watcher.status().seenCount, 24);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("trusted pagination stops on stale pages or no new posts, preserves out-of-order fresh posts, and rejects missing cursors", async () => {
  const keys = ["WATCH_DB", "WATCH_SEEN", "WATCH_DETECTIONS", "WATCH_SUPPORT_ACCOUNTS", "WATCH_X_AUTH_TOKEN", "WATCH_X_CT0"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const recent = new Date(Date.now() - 60000).toUTCString();
  const old = new Date(Date.now() - 40 * 60000).toUTCString();
  const skewed = new Date(Date.now() - 31 * 60000).toUTCString();
  const tweet = (id, createdAt) => ({ content: { itemContent: { tweet_results: { result: {
    rest_id: String(id), legacy: { full_text: "Normal post", created_at: createdAt },
    core: { user_results: { result: { rest_id: "42", legacy: { screen_name: "DrevZiga" } } } },
  } } } } });
  const cases = [
    { name: "stale page", pages: [[tweet(1, old)], [tweet(2, recent)]], cursors: [""], seen: 1 },
    { name: "clock skew", pages: [[tweet(1, skewed)], [tweet(2, recent)]], cursors: ["", "next-1"], seen: 2 },
    { name: "pinned fresh post", pages: [[tweet(1, recent), tweet(2, old)], [tweet(3, recent)]], cursors: ["", "next-1"], seen: 3 },
    { name: "duplicate page", pages: [[tweet(1, recent)], [tweet(1, recent)], [tweet(2, recent)]], cursors: ["", "next-1"], seen: 1 },
    { name: "three-page cap", pages: [[tweet(1, recent)], [tweet(2, recent)], [tweet(3, recent)], [tweet(4, recent)]], cursors: ["", "next-1", "next-2"], seen: 3 },
    { name: "missing cursor on full page", pages: [Array.from({ length: 12 }, (_, index) => tweet(index + 1, recent))], cursors: [""], seen: 0, error: /missing Bottom cursor/ },
    { name: "short terminal page", pages: [[tweet(1, recent)]], cursors: [""], seen: 1, noCursor: true },
  ];
  try {
    for (const scenario of cases) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-pagination-"));
      process.env.WATCH_DB = path.join(directory, "watcher.sqlite");
      process.env.WATCH_SEEN = path.join(directory, "seen.json");
      process.env.WATCH_DETECTIONS = path.join(directory, "detections.jsonl");
      process.env.WATCH_SUPPORT_ACCOUNTS = "";
      delete process.env.WATCH_X_AUTH_TOKEN;
      delete process.env.WATCH_X_CT0;
      const cursors = [];
      const json = (body) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.endsWith("/guest/activate.json")) return json({ guest_token: "guest" });
        if (url.includes("/UserByScreenName")) return json({ data: { user: { result: { rest_id: JSON.parse(new URL(url).searchParams.get("variables")).screen_name === "DrevZiga" ? "42" : "99" } } } });
        if (url.includes("/UserTweets")) {
          const { userId, cursor } = JSON.parse(new URL(url).searchParams.get("variables"));
          if (userId !== "42") return json({ data: { user: { result: { timeline_v2: { timeline: { instructions: [] } } } } } });
          cursors.push(cursor || "");
          const entries = [...(scenario.pages[cursors.length - 1] || [])];
          if (!scenario.noCursor && !scenario.error && (cursors.length < scenario.pages.length || scenario.name === "three-page cap")) entries.push({ content: { cursorType: "Bottom", value: `next-${cursors.length}` } });
          return json({ data: { user: { result: { timeline_v2: { timeline: { instructions: [{ entries }] } } } } } });
        }
        throw new Error(`unexpected fetch ${url}`);
      };
      try {
        const watcher = createWatcher({ log: { info() {}, error() {} } });
        watcher.start();
        for (let i = 0; i < 200 && !watcher.status().lastPoll; i++) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.ok(watcher.status().lastPoll, scenario.name);
        assert.deepEqual(cursors, scenario.cursors, scenario.name);
        assert.equal(watcher.status().seenCount, scenario.seen, scenario.name);
        if (scenario.error) assert.match(watcher.status().lastError, scenario.error);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("exact WM and SWM checks retry mismatched assets without GRAPH queries", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-scoped-"));
  const keys = ["WATCH_DB", "WATCH_SEEN", "WATCH_DETECTIONS", "DKG_API_TOKEN_FILE", "DKG_API_URL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.WATCH_DB = path.join(directory, "watcher.sqlite");
  process.env.WATCH_SEEN = path.join(directory, "seen.json");
  process.env.WATCH_DETECTIONS = path.join(directory, "detections.jsonl");
  process.env.DKG_API_TOKEN_FILE = path.join(directory, "token");
  process.env.DKG_API_URL = "http://127.0.0.1:9200";
  fs.writeFileSync(process.env.DKG_API_TOKEN_FILE, "test-token");
   const views = [];
   let visible = false;
   let rawBindings = [];
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith("/api/knowledge-assets")) return json({ error: "temporary conflict" }, 409);
    if (url.includes("/api/knowledge-assets/")) return json({ assertionGraph: "did:dkg:context-graph:other/_shared_memory/asset" });
    if (url.endsWith("/api/query")) {
      const body = JSON.parse(options.body);
      views.push(body.view);
      assert.equal(body.contextGraphId, process.env.DKG_PUBLIC_GRAPH_ID || "trac-marketing");
       assert.match(body.sparql, /^PREFIX rdf: <http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#> SELECT DISTINCT \?s \?p \?o WHERE \{ VALUES \(\?s \?p\)/);
       assert.match(body.sparql, /\} \?s \?p \?o \} LIMIT 101$/);
       assert.doesNotMatch(body.sparql, /<http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#type>/);
       return json({ result: { type: "bindings", bindings: visible && body.view === "shared-working-memory" ? rawBindings : [] } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const watcher = createWatcher({ log: { info() {}, error() {} } });
    await watcher.test({ post_id: "123", summary: "OriginTrail update" });
    const db = openStore(process.env.WATCH_DB, process.env.WATCH_SEEN, process.env.WATCH_DETECTIONS);
    assert.equal(db.prepare("SELECT status FROM deliveries WHERE post_id = '123' AND stage = 'raw-dkg'").get().status, "pending");
    assert.equal(dkgHealth(watcher.status()).ok, false);
    assert.equal(dkgHealth(watcher.status()).retryingDkg, 2);
     assert.deepEqual(views.slice(0, 2), ["working-memory", "shared-working-memory"]);
     const row = db.prepare("SELECT * FROM observations WHERE post_id = '123'").get();
     rawBindings = buildAssets({ post_id: row.post_id, account: row.account, post_url: row.post_url,
       summary: row.summary, created_at: row.created_at }, JSON.parse(row.classification_json), row.observed_at).raw.quads
       .map(({ subject, predicate, object }) => ({ s: subject, p: predicate, o: object }));
     visible = true;
    db.prepare("UPDATE deliveries SET next_attempt_at = ? WHERE post_id = '123' AND stage = 'raw-dkg'").run(new Date(Date.now() - 1000).toISOString());
    db.close();
    await watcher.test({ post_id: "123", summary: "OriginTrail update" });
    const checked = openStore(process.env.WATCH_DB, process.env.WATCH_SEEN, process.env.WATCH_DETECTIONS);
    assert.equal(checked.prepare("SELECT status FROM deliveries WHERE post_id = '123' AND stage = 'raw-dkg'").get().status, "completed");
    checked.close();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("409 unfinished promote quarantines delivery without automatic SWM share", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-promote-"));
  const keys = ["WATCH_DB", "WATCH_SEEN", "WATCH_DETECTIONS", "DKG_API_TOKEN_FILE"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.WATCH_DB = path.join(directory, "watcher.sqlite");
  process.env.WATCH_SEEN = path.join(directory, "seen.json");
  process.env.WATCH_DETECTIONS = path.join(directory, "detections.jsonl");
  process.env.DKG_API_TOKEN_FILE = path.join(directory, "token");
  fs.writeFileSync(process.env.DKG_API_TOKEN_FILE, "test-token");
  const requests = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/api/knowledge-assets")) {
      const name = JSON.parse(options.body).name;
      return { ok: false, status: 409, json: async () => ({ code: "KA_PROMOTE_RECOVERY_REQUIRED",
        error: `Assertion "${name}" has an unfinished promote; retry assertionPromote before mutating its draft` }) };
    }
    if (url.includes("/api/knowledge-assets/")) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ result: { type: "boolean", value: false } }) };
  };
  try {
    const watcher = createWatcher({ log: { info() {}, error() {} } });
    await watcher.test({ post_id: "123", summary: "OriginTrail update" });
    const failure = watcher.status().dkgFailures.find((row) => row.stage === "derived-dkg");
    assert.equal(failure.post_id, "123");
    assert.equal(failure.attempts, 1);
    assert.ok(!requests.some((url) => url.includes("/swm/share")));
    const db = openStore(process.env.WATCH_DB, process.env.WATCH_SEEN, process.env.WATCH_DETECTIONS);
    assert.equal(db.prepare("SELECT status FROM deliveries WHERE post_id = '123' AND stage = 'derived-dkg'").get().status, "quarantined");
    db.close();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("inactive WM draft retries, then quarantines if backend cannot verify exact content", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-inactive-"));
  const keys = ["WATCH_DB", "WATCH_SEEN", "WATCH_DETECTIONS", "DKG_API_TOKEN_FILE"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.WATCH_DB = path.join(directory, "watcher.sqlite");
  process.env.WATCH_SEEN = path.join(directory, "seen.json");
  process.env.WATCH_DETECTIONS = path.join(directory, "detections.jsonl");
  process.env.DKG_API_TOKEN_FILE = path.join(directory, "token");
  fs.writeFileSync(process.env.DKG_API_TOKEN_FILE, "test-token");
  let writes = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/api/query")) throw new Error("backend unavailable");
    if (String(input).endsWith("/api/knowledge-assets")) {
      writes++;
      return { ok: false, status: 409, json: async () => ({ error: "not an active Working Memory draft" }) };
    }
    throw new Error("unexpected read");
  };
  try {
    const watcher = createWatcher({ log: { info() {}, error() {} } });
    await watcher.test({ post_id: "123", summary: "OriginTrail update" });
    assert.equal(watcher.status().dkgFailures.length, 0);
    const db = openStore(process.env.WATCH_DB, process.env.WATCH_SEEN, process.env.WATCH_DETECTIONS);
    assert.deepEqual(db.prepare("SELECT stage, status, attempts FROM deliveries ORDER BY stage").all().map((row) => ({ ...row })),
      [{ stage: "derived-dkg", status: "pending", attempts: 1 }, { stage: "raw-dkg", status: "pending", attempts: 1 }]);
    db.prepare("UPDATE deliveries SET attempts = 11, next_attempt_at = ? WHERE post_id = '123'").run(new Date(0).toISOString());
    db.close();
    await watcher.test({ post_id: "123", summary: "OriginTrail update" });
    assert.deepEqual(watcher.status().dkgFailures.map((row) => row.attempts), [12, 12]);
    assert.equal(writes, 4);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("retry exhaustion quarantines after twelfth failed DKG attempt", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-exhaust-"));
  const keys = ["WATCH_DB", "WATCH_SEEN", "WATCH_DETECTIONS", "DKG_API_TOKEN_FILE"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.WATCH_DB = path.join(directory, "watcher.sqlite");
  process.env.WATCH_SEEN = path.join(directory, "seen.json");
  process.env.WATCH_DETECTIONS = path.join(directory, "detections.jsonl");
  process.env.DKG_API_TOKEN_FILE = path.join(directory, "token");
  fs.writeFileSync(process.env.DKG_API_TOKEN_FILE, "test-token");
  let writes = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/api/knowledge-assets")) writes++;
    return { ok: false, status: 503, json: async () => ({ error: "temporary failure" }) };
  };
  try {
    const watcher = createWatcher({ log: { info() {}, error() {} } });
    await watcher.test({ post_id: "123", summary: "OriginTrail update" });
    const db = openStore(process.env.WATCH_DB, process.env.WATCH_SEEN, process.env.WATCH_DETECTIONS);
    db.prepare(`UPDATE deliveries SET attempts = 11, next_attempt_at = ? WHERE post_id = '123' AND stage = 'derived-dkg'`)
      .run(new Date(0).toISOString());
    db.close();
    await watcher.test({ post_id: "123", summary: "OriginTrail update" });
    const failure = watcher.status().dkgFailures.find((row) => row.stage === "derived-dkg");
    assert.equal(failure.attempts, 12);
    assert.match(failure.last_error, /manual DKG lifecycle review required/);
    assert.equal(dkgHealth(watcher.status()).ok, false);
    assert.equal(writes, 3);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("public DKG health contains only aggregate counts", () => {
  const failure = { post_id: "private-post", last_error: "private error", raw_asset: "private-asset" };
  const status = { queue: [{ stage: "raw-dkg", status: "pending", count: 2 },
    { stage: "derived-dkg", status: "pending", count: 1 },
    { stage: "webhook", status: "pending", count: 9 }], retryingDkg: 1, dkgFailures: [failure] };
  assert.deepEqual(dkgHealth(status), { ok: false, pendingDkg: 3, retryingDkg: 1, quarantinedDkg: 1 });
  assert.equal(JSON.stringify(dkgHealth(status)).includes("private"), false);
  assert.deepEqual(status.dkgFailures, [failure]);
});

test("restart quarantines pending DKG jobs without replacing completed jobs", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-quarantine-"));
  const keys = ["WATCH_DB", "WATCH_SEEN", "WATCH_DETECTIONS", "DKG_API_TOKEN_FILE"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.WATCH_DB = path.join(directory, "watcher.sqlite");
  process.env.WATCH_SEEN = path.join(directory, "seen.json");
  process.env.WATCH_DETECTIONS = path.join(directory, "detections.jsonl");
  process.env.DKG_API_TOKEN_FILE = path.join(directory, "token");
  fs.writeFileSync(process.env.DKG_API_TOKEN_FILE, "test-token");
  const db = openStore(process.env.WATCH_DB, process.env.WATCH_SEEN, process.env.WATCH_DETECTIONS);
  for (const [id, attempts, error] of [["123", 150, "DKG 500: not readable as sealed after creation"],
    ["124", 1, "DKG 409: unfinished promote; retry assertionPromote"], ["125", 12, "DKG 503: unavailable"],
    ["126", 12, "DKG 409: unfinished promote; retry assertionPromote"]]) {
    db.prepare(`INSERT INTO observations (post_id, account, kind, post_url, summary, observed_at, classification_json)
      VALUES (?, '@origin_trail', 'official', '', 'test', ?, '{}')`).run(id, new Date().toISOString());
    db.prepare(`INSERT INTO deliveries (post_id, stage, attempts, next_attempt_at, last_error)
      VALUES (?, 'derived-dkg', ?, ?, ?)`).run(id, attempts, new Date(0).toISOString(), error);
  }
  db.prepare(`UPDATE deliveries SET status = 'completed', completed_at = '2026-09-29T00:00:00Z'
    WHERE post_id = '126' AND stage = 'derived-dkg'`).run();
  db.close();
  let writes = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/api/knowledge-assets")) writes++;
    throw new Error("read-only fixture");
  };
  try {
    const watcher = createWatcher({ log: { info() {}, error() {} } });
    assert.equal(watcher.status().dkgFailures.length, 3);
    assert.equal(watcher.status().dkgFailures.find((row) => row.post_id === "124").last_error.includes("unfinished promote"), true);
    assert.deepEqual(dkgHealth(watcher.status()), {
      ok: false, pendingDkg: 0, retryingDkg: 0, quarantinedDkg: 3,
    });
    assert.equal(watcher.status().queue.find((row) => row.stage === "derived-dkg" && row.status === "quarantined").count, 3);
    const reopened = openStore(process.env.WATCH_DB, process.env.WATCH_SEEN, process.env.WATCH_DETECTIONS);
    assert.deepEqual(reopened.prepare("SELECT post_id, status, attempts, completed_at FROM deliveries ORDER BY post_id").all().map((row) => ({ ...row })),
      ["123", "124", "125"].map((post_id, index) => ({ post_id, status: "quarantined", attempts: [150, 1, 12][index], completed_at: null }))
        .concat({ post_id: "126", status: "completed", attempts: 12, completed_at: "2026-09-29T00:00:00Z" }));
    reopened.close();
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("raw and derived legacy quarantine recover only with exact WM/SWM quads", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "x-watcher-derived-recovery-"));
  const keys = ["WATCH_DB", "WATCH_SEEN", "WATCH_DETECTIONS", "DKG_API_TOKEN_FILE", "WATCH_DKG_RECONCILE_MS"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.WATCH_DB = path.join(directory, "watcher.sqlite");
  process.env.WATCH_SEEN = path.join(directory, "seen.json");
  process.env.WATCH_DETECTIONS = path.join(directory, "detections.jsonl");
  process.env.DKG_API_TOKEN_FILE = path.join(directory, "token");
  process.env.WATCH_DKG_RECONCILE_MS = "20";
  fs.writeFileSync(process.env.DKG_API_TOKEN_FILE, "test-token");
  const db = openStore(process.env.WATCH_DB, process.env.WATCH_SEEN, process.env.WATCH_DETECTIONS);
  const post = { post_id: "123", account: "@origin_trail", post_url: "https://x.com/origin_trail/status/123",
    summary: "OriginTrail @umanitek #DKG https://example.com", created_at: "2026-09-29T00:00:00Z" };
  const classification = classifyPost(post, ["origin_trail"]);
  const observedAt = "2026-09-29T01:00:00Z";
   const assets = buildAssets(post, classification, observedAt);
   const quads = assets.derived.quads;
   const rawQuads = assets.raw.quads;
  db.prepare(`INSERT INTO observations (post_id, account, kind, post_url, summary, created_at, observed_at, classification_json)
    VALUES (?, ?, 'official', ?, ?, ?, ?, ?)`).run(post.post_id, post.account, post.post_url, post.summary, post.created_at, observedAt, JSON.stringify(classification));
   const diagnostic = "DKG 409: not an active Working Memory draft; manual DKG lifecycle review required";
   for (const stage of ["raw-dkg", "derived-dkg"]) db.prepare(`INSERT INTO deliveries (post_id, stage, status, attempts, next_attempt_at, last_error)
     VALUES ('123', ?, 'quarantined', 2, ?, ?)`).run(stage, observedAt, diagnostic);
   db.close();
  const binding = ({ subject, predicate, object }) => ({ s: { type: "uri", value: subject }, p: { type: "uri", value: predicate },
    o: object.startsWith('"') ? (() => { const match = /^("(?:\\.|[^"\\])*")(?:\^\^<([^>]+)>)?$/.exec(object);
      return { type: "literal", value: JSON.parse(match[1]), ...(match[2] ? { datatype: match[2] } : {}) }; })()
      : { type: "uri", value: object } });
   const full = quads.map(binding);
   const rawFull = rawQuads.map(binding);
   let mode = "missing";
  let writes = 0;
  let queries = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith("/api/knowledge-assets")) { writes++; throw new Error("unexpected write"); }
    if (url.endsWith("/api/query")) {
      const request = JSON.parse(options.body);
       assert.ok(["working-memory", "shared-working-memory"].includes(request.view));
       assert.equal(request.contextGraphId, process.env.DKG_PUBLIC_GRAPH_ID || "trac-marketing");
       assert.match(request.sparql, /LIMIT 101/);
       queries++;
       if (mode === "error") throw new Error("query unavailable");
       const expected = request.sparql.includes("schema.org/articleBody") ? rawFull : full;
       const rows = mode === "missing" ? expected.slice(0, -1) : mode === "mismatch"
         ? expected.map((row, index) => index === 2 ? { ...row, o: { type: "literal", value: "wrong" } } : row)
         : mode === "ambiguous" ? [...expected, expected[0]] : request.view === "shared-working-memory" ? expected : [];
      return { ok: true, json: async () => ({ result: { type: "bindings", bindings: rows } }) };
    }
    throw new Error("offline fixture");
  };
  const wait = async (condition) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("recovery timed out");
  };
  try {
    assert.equal(matchesDerivedQuads({ result: { type: "bindings", bindings: full } }, quads), true);
    for (const variant of [full.slice(0, -1), [...full, full[0]], full.map((row, i) => i === 2 ? { ...row, o: { type: "literal", value: "wrong" } } : row)]) {
      assert.equal(matchesDerivedQuads({ result: { type: "bindings", bindings: variant } }, quads), false);
    }
    assert.equal(matchesDerivedQuads({ result: { type: "boolean", value: true } }, quads), false);
    const watcher = createWatcher({ log: { info() {}, error() {} } });
    watcher.start();
    for (const value of ["missing", "mismatch", "ambiguous", "error"]) {
      mode = value;
      const before = queries;
      await wait(() => queries > before);
       assert.deepEqual(watcher.status().dkgFailures.map((row) => row.last_error), [diagnostic, diagnostic]);
     }
     mode = "match";
     await wait(() => watcher.status().dkgFailures.length === 0);
     const checked = openStore(process.env.WATCH_DB, process.env.WATCH_SEEN, process.env.WATCH_DETECTIONS);
     assert.deepEqual(checked.prepare("SELECT stage, status FROM deliveries WHERE post_id = '123' ORDER BY stage").all().map((row) => ({ ...row })),
       [{ stage: "derived-dkg", status: "completed" }, { stage: "raw-dkg", status: "completed" }]);
    checked.close();
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("derived quad matching accepts string Graph API bindings without confusing RDF terms", () => {
  const subject = "https://example.org/classification/1";
  const predicate = "https://example.org/value";
  const datatype = "http://www.w3.org/2001/XMLSchema#integer";
  const expected = [
    { subject, predicate, object: "https://example.org/target" },
    { subject, predicate: `${predicate}/label`, object: '"https://example.org/target"' },
    { subject, predicate: `${predicate}/count`, object: `"2"^^<${datatype}>` },
  ];
  const rows = expected.map(({ subject: s, predicate: p, object: o }) => ({ s, p, o }));
  const matches = (bindings) => matchesDerivedQuads({ result: { type: "bindings", bindings } }, expected);
  assert.equal(matches(rows), true);
  assert.equal(matches(rows.map((row, index) => index === 2 ? { ...row, o: { type: "typed-literal", value: "2", datatype } } : row)), true);
  assert.equal(matches(rows.map((row) => ({ s: { type: "uri", value: row.s }, p: { type: "uri", value: row.p },
    o: row.o.startsWith('"') ? { type: "literal", value: JSON.parse(row.o.match(/^"(?:\\.|[^"\\])*"/)[0]),
      ...(row.o.includes("^^<") ? { datatype } : {}) } : { type: "uri", value: row.o } }))), true);
  for (const object of ['"https://example.org/target"', "https://example.org/target", '"2"',
    '"broken\\x"', '"unterminated', "not a URI", "<https://example.org/target>"]) {
    const index = object === '"https://example.org/target"' ? 0 : object === "https://example.org/target" ? 1 : 2;
    assert.equal(matches(rows.map((row, i) => i === index ? { ...row, o: object } : row)), false, object);
  }
  assert.equal(matches(rows.map((row, i) => i === 0 ? { ...row, o: { type: "literal", value: "https://example.org/target" } } : row)), false);
  assert.equal(matches(rows.map((row, i) => i === 1 ? { ...row, o: { type: "uri", value: "https://example.org/target" } } : row)), false);
  assert.equal(matches(rows.map((row, i) => i === 2 ? { ...row, o: { type: "typed-literal", value: "2", datatype: "https://example.org/other" } } : row)), false);
  assert.equal(matches(rows.map((row, i) => i === 2 ? { ...row, o: { type: "typed-literal", value: "2" } } : row)), false);
  const dateTime = "http://www.w3.org/2001/XMLSchema#dateTime";
  const dated = [{ subject, predicate, object: `"2026-10-01T15:23:11.380Z"^^<${dateTime}>` }];
  const datedMatch = (object) => matchesDerivedQuads({ result: { type: "bindings", bindings: [{ s: subject, p: predicate, o: object }] } }, dated);
  assert.equal(datedMatch(`"2026-10-01T15:23:11.38Z"^^<${dateTime}>`), true);
  assert.equal(datedMatch({ type: "literal", value: "2026-10-01T15:23:11.38Z", datatype: dateTime }), true);
  assert.equal(datedMatch(`"2026-10-01T15:23:11.381Z"^^<${dateTime}>`), false);
  assert.equal(datedMatch('"2026-10-01T15:23:11.38Z"'), false);
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
