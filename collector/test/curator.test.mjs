import test from "node:test";
import assert from "node:assert/strict";
import { askTrue, canonicalUrl, validateCollectivePush, xPostQuads, intake, normalizeDraftName, isCollectivePush } from "../curator.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("explicit intake lookup reaches position 86 while review list stays bounded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curator-lookup-"));
  const filename = path.join(dir, "intake.sqlite");
  const db = new DatabaseSync(filename);
  db.exec("CREATE TABLE drafts (name TEXT PRIMARY KEY, queued_at TEXT, reviewed_at TEXT)");
  for (let i = 0; i < 85; i++) db.prepare("INSERT INTO drafts VALUES (?, ?, NULL)").run(`draft-${i}`, String(i).padStart(3, "0"));
  db.prepare("INSERT INTO drafts VALUES (?, '086', NULL)").run("collective-push-latest");
  db.close();
  try {
    assert.equal(intake(undefined, filename).length, 40);
    assert.equal(intake("collective-push-latest", filename).name, "collective-push-latest");
    assert.equal(intake("missing", filename), undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("push detection and validation share normalized names and reject invalid metadata", () => {
  const push = { url: "https://x.com/Author/status/123456789", postId: "123456789", publisher: "@Author",
    issuedAt: "2026-09-25T10:00:00Z", expiresAt: "2026-09-25T12:00:00Z", angle: "Context", text: "Campaign guidance with enough detail to establish intent." };
  for (const name of ["COLLECTIVE PUSH-demo", "collective_push-demo", "collectivepush-demo", "prefix-collective-push-demo"]) {
    assert.equal(isCollectivePush(name), true);
    assert.equal(validateCollectivePush({ ...push, name: normalizeDraftName(name) }, Date.parse("2026-09-25T11:00:00Z")), "https://x.com/i/status/123456789");
  }
  assert.throws(() => validateCollectivePush({ ...push, name: "collective-push-demo", publisher: " " }, Date.parse("2026-09-25T11:00:00Z")), /lacks/);
  assert.throws(() => validateCollectivePush({ ...push, name: "collective-push-demo", issuedAt: "2026-09-25T11:06:00Z" }, Date.parse("2026-09-25T11:00:00Z")), /future/);
});

test("promotion confirms SWM, preserves provenance, audits and acknowledges only confirmed shares", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curator-promotion-"));
  const filename = path.join(dir, "intake.sqlite");
  const review = path.join(dir, "review.sqlite");
  const tokenFile = path.join(dir, "token");
  fs.writeFileSync(tokenFile, "test-token");
  const db = new DatabaseSync(filename);
  db.exec("CREATE TABLE drafts (name TEXT PRIMARY KEY, queued_at TEXT, reviewed_at TEXT)");
  const name = "collective-push-demo";
  for (let i = 0; i < 85; i++) db.prepare("INSERT INTO drafts VALUES (?, ?, NULL)").run(`draft-${i}`, String(i).padStart(3, "0"));
  db.prepare("INSERT INTO drafts VALUES (?, '086', NULL)").run(name);
  let visible = false;
  let confirm = false;
  let created;
  let shareCount = 0;
  const ns = "https://www.dkgswarm.com/ontology/curator/";
  const fields = { "https://schema.org/url": "https://x.com/Author/status/123456789", "https://schema.org/publisher": "@Author",
    "http://www.w3.org/2000/01/rdf-schema#comment": "Campaign guidance with enough detail to establish intent.",
    "https://schema.org/identifier": "123456789", "https://schema.org/dateCreated": new Date(Date.now() - 60000).toISOString(),
    "https://schema.org/expires": new Date(Date.now() + 3600000).toISOString(), [`${ns}proposedAngle`]: "Context" };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    let result = {};
    if (req.url === "/api/query") {
      if (body.sparql.startsWith("ASK")) result = { result: { value: visible } };
      else if (body.sparql.startsWith("SELECT ?p")) result = { result: { bindings: Object.entries(fields).map(([p, o]) => ({ p, o })) } };
      else result = { result: { bindings: [] } };
    } else if (req.url === "/api/knowledge-assets") created = body;
    else if (req.url.endsWith("/swm/share")) { shareCount++; visible = confirm; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const execute = promisify(execFile);
  const run = () => execute(process.execPath, [new URL("../curator.mjs", import.meta.url).pathname, "promote-community", name], {
    env: { ...process.env, DKG_API_URL: `http://127.0.0.1:${server.address().port}`, DKG_API_TOKEN_FILE: tokenFile,
      TRAC_CURATOR_INTAKE: filename, TRAC_CURATOR_REVIEW: review },
  });
  try {
    await assert.rejects(run(), /not queryable/);
    assert.equal(db.prepare("SELECT reviewed_at FROM drafts WHERE name = ?").get(name).reviewed_at, null);
    confirm = true;
    const promoted = await run();
    assert.match(promoted.stdout, /"promoted":"curator-push-collective-push-demo"/);
    assert.equal(created.finalize, false);
    assert.equal(created.alsoShareSwm, false);
    assert.equal(created.quads.find((q) => q.predicate === `${ns}derivedFrom`).object, `https://www.dkgswarm.com/ka/${name}`);
    assert.match(created.quads.find((q) => q.predicate === `${ns}sourceTier`).object, /authenticated-writer-directive/);
    assert.ok(db.prepare("SELECT reviewed_at FROM drafts WHERE name = ?").get(name).reviewed_at);
    const audit = new DatabaseSync(review);
    assert.equal(audit.prepare("SELECT status FROM decisions WHERE id = ?").get(name).status, "promoted");
    audit.close();
    db.prepare("UPDATE drafts SET reviewed_at = NULL WHERE name = ?").run(name);
    const recovered = await run();
    assert.match(recovered.stdout, /"recovered":true/);
    assert.equal(shareCount, 2);
  } finally {
    db.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical URL strips tracking and normalizes X post identity", () => {
  assert.equal(canonicalUrl("http://www.example.org/story/?utm_source=x&b=2&a=1#part"), "https://example.org/story?a=1&b=2");
  assert.equal(canonicalUrl("https://twitter.com/SomeUser/status/123456789?ref_src=feed"), "https://x.com/i/status/123456789");
  assert.equal(canonicalUrl("https://x.com/i/status/123456789/"), "https://x.com/i/status/123456789");
});

test("DKG ASK result format confirms queryable SWM content", () => {
  assert.equal(askTrue({ result: { type: "boolean", value: true, bindings: [{ result: "true" }] } }), true);
  assert.equal(askTrue({ result: { type: "boolean", value: false } }), false);
});

test("promoted X asset keeps publication time, publisher, tier, and claim status", () => {
  const built = xPostQuads({
    post_id: "12345678", account: "@origintraildev", post_url: "https://x.com/origintraildev/status/12345678",
    summary: "OriginTrail dev notes a specific DKG release with enough text to keep.",
    created_at: "Thu Oct 01 12:00:00 +0000 2026", observed_at: "2026-10-01T12:05:00.000Z",
    classification_json: JSON.stringify({ sourceTier: "official" }),
  });
  const object = (predicate) => built.quads.find((quad) => quad.predicate === predicate)?.object;
  assert.equal(object("https://schema.org/datePublished"), JSON.stringify("2026-10-01T12:00:00.000Z"));
  assert.equal(object("https://www.dkgswarm.com/ontology/curator/publisher"), JSON.stringify("@origintraildev"));
  assert.equal(object("https://www.dkgswarm.com/ontology/curator/sourceTier"), JSON.stringify("official"));
  assert.match(object("https://www.dkgswarm.com/ontology/curator/claimStatus"), /not independently verified/);
  assert.throws(() => xPostQuads({
    post_id: "12345678", account: "@a", summary: "short", created_at: "not-a-date", post_url: "https://x.com/a/status/12345678",
  }), /insufficient source evidence/);
});

test("valid writer push remains separate from source evidence and has bounded expiry", () => {
  const push = { name: "collective-push-demo", url: "https://x.com/Author/status/123456789", postId: "123456789", publisher: "@Author",
    issuedAt: "2026-09-25T10:00:00Z", expiresAt: "2026-09-25T12:00:00Z", angle: "Explain DKG context", text: "Campaign guidance with enough detail to establish intent." };
  assert.equal(validateCollectivePush(push, Date.parse("2026-09-25T11:00:00Z")), "https://x.com/i/status/123456789");
  assert.throws(() => validateCollectivePush(push, Date.parse("2026-09-25T12:00:00Z")), /expired/);
  assert.throws(() => validateCollectivePush({ ...push, postId: "987654321" }, Date.parse("2026-09-25T11:00:00Z")), /target URL/);
});
