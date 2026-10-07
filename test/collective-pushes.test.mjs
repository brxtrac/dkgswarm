import assert from "node:assert/strict";
import test from "node:test";
import { pushSubjectQuery, pushMetadataQuery, parsePushPage, pushBindings, collectivePushPageSize } from "../collective-pushes.mjs";

const base = "https://www.dkgswarm.com/ka/";
const ns = "https://www.dkgswarm.com/ontology/curator/";
const subject = (id) => `${base}collective-push-x-${id}`;
const row = (s, p, o) => ({ s, p, o });
const lit = (value) => JSON.stringify(value);
const details = (s, tier = "trusted-source-direct") => [
  row(s, `${ns}targetPost`, `https://x.com/i/status/${s.match(/\d+$/)[0]}`),
  row(s, `${ns}publisher`, lit("origin_trail")),
  row(s, `${ns}sourceTier`, lit(tier)),
  row(s, "https://schema.org/dateCreated", lit("2026-09-29T10:00:00.000Z")),
  row(s, "https://schema.org/expires", lit("2026-09-29T12:00:00.000Z")),
];
const response = (bindings) => ({ result: { bindings } });
const directResponse = (bindings) => ({ bindings });

test("keyset pagination handles bursts beyond 100 active subjects without offset cap", () => {
  const all = Array.from({ length: 145 }, (_, i) => subject(String(100000000 + i))).reverse();
  const now = Date.parse("2026-09-29T11:00:00Z");
  let cursor;
  const seen = [];
  do {
    const query = pushSubjectQuery(cursor, now);
    assert.match(query, /ORDER BY DESC\(\?s\) LIMIT 21/);
    assert.doesNotMatch(query, /OFFSET/);
    const after = cursor ? JSON.parse(Buffer.from(cursor, "base64url")).after : null;
    const remaining = all.filter((s) => !after || s < after);
    const page = remaining.slice(0, collectivePushPageSize + 1);
    const data = parsePushPage(response(page.map((s) => ({ s }))), response(page.slice(0, collectivePushPageSize).flatMap((s) => details(s))), cursor, now);
    seen.push(...data.entries.map((entry) => entry.subject));
    cursor = data.nextCursor;
    assert.equal(data.complete, cursor === null);
  } while (cursor);
  assert.deepEqual(seen, all);
});

test("active query excludes expired history before pagination and cursor remains snapshot-scoped", () => {
  const now = Date.parse("2026-09-29T11:00:00Z");
  const query = pushSubjectQuery(undefined, now);
  assert.match(query, /schema.org\/expires/);
  assert.match(query, /dateTime>\(STR\(\?expiry\)\) > "2026-09-29T11:00:00.000Z"/);
  assert.deepEqual(parsePushPage(response([]), response([]), undefined, now), { entries: [], nextCursor: null, complete: true });
  const all = Array.from({ length: 22 }, (_, i) => subject(String(100000000 + i))).reverse();
  const first = parsePushPage(response(all.slice(0, 21).map((s) => ({ s }))), response(all.slice(0, 20).flatMap((s) => details(s))), undefined, now);
  assert.equal(first.entries.length, 20);
  assert.match(pushSubjectQuery(first.nextCursor, now + 1000), /2026-09-29T11:00:00.000Z/);
  assert.match(pushSubjectQuery(first.nextCursor, now + 1000), /FILTER\(STR\(\?s\) < /);
  assert.throws(() => pushSubjectQuery(first.nextCursor, now + 3600001), /Expired/);
  assert.throws(() => pushSubjectQuery("forged"), /cursor/);
  assert.throws(() => parsePushPage(response([{ s: all[0] }]), response(details(all[0])), first.nextCursor, now), /order/);
  assert.doesNotMatch(pushSubjectQuery(undefined, now + 1000), /FILTER\(STR\(\?s\) < /);
  const delayed = subject("100000000");
  const fresh = parsePushPage(response([{ s: delayed }]), response(details(delayed)), undefined, now + 1000);
  assert.equal(fresh.entries[0].subject, delayed);
});

test("metadata distinguishes namespace candidates without asserting verified authorship", () => {
  const direct = subject("123456789");
  const curated = `${base}curator-push-collective-push-example`;
  const underscored = `${base}curator-push-collective_push_example`;
  const compact = `${base}curator-push-collectivepush-example`;
  const draft = `${base}collective-push-draft`;
  assert.match(pushSubjectQuery(), /CollectivePush/);
  assert.doesNotMatch(pushSubjectQuery(), /OFFSET/);
  assert.match(pushMetadataQuery([direct, curated, underscored, compact]), /VALUES \?s/);
  for (const name of [curated, underscored, compact]) assert.doesNotThrow(() => pushMetadataQuery([name]));
  assert.match(pushSubjectQuery(), /collective\[-_\]\?push/);
  const curatedRows = [
    row(curated, `${ns}targetPost`, "https://x.com/i/status/123456789"),
    row(curated, `${ns}publisher`, lit("someone")),
    row(curated, `${ns}sourceTier`, lit("authenticated-writer-directive")),
    row(curated, "https://schema.org/dateCreated", lit("2026-09-29T10:00:00Z")),
    row(curated, "https://schema.org/expires", lit("2026-09-29T12:00:00Z")),
  ];
  const result = parsePushPage(response([{ s: curated }, { s: direct }]), response([...curatedRows, ...details(direct)]));
  assert.equal(result.entries[0].category, "curated-namespace");
  assert.equal(result.entries[1].category, "watcher-namespace");
  assert.deepEqual(result.entries.map((entry) => entry.verifiedOriginal), [false, false]);
  for (const name of [underscored, compact]) {
    const entry = parsePushPage(response([{ s: name }]), response(curatedRows.map((item) => ({ ...item, s: name })))).entries[0];
    assert.equal(entry.category, "curated-namespace");
    assert.equal(entry.verifiedOriginal, false);
  }
  assert.throws(() => pushSubjectQuery(draft), /cursor/);
  assert.throws(() => pushMetadataQuery([draft]), /subjects/);
  assert.equal(parsePushPage(response([{ s: direct }]), response(details(direct, "community-unverified"))).entries[0].category, "unverified-metadata");
  assert.equal(parsePushPage(response([{ s: direct }]), response(details(direct).map((r) => r.p === `${ns}publisher` ? { ...r, o: lit("stranger") } : r))).entries[0].category, "unverified-metadata");
});

test("both backend binding shapes preserve subject order and metadata", () => {
  const first = subject("123456790");
  const second = subject("123456789");
  const subjects = [{ s: first }, { s: second }];
  const metadata = [...details(second), ...details(first)];
  for (const wrapSubjects of [response, directResponse]) {
    for (const wrapMetadata of [response, directResponse]) {
      const result = parsePushPage(wrapSubjects(subjects), wrapMetadata(metadata));
      assert.deepEqual(result.entries.map((entry) => entry.subject), [first, second]);
      assert.deepEqual(result.entries.map((entry) => entry.category), ["watcher-namespace", "watcher-namespace"]);
      assert.deepEqual(result.entries.map((entry) => entry.verifiedOriginal), [false, false]);
      assert.deepEqual(pushBindings(wrapSubjects(subjects)), subjects);
    }
  }
});

test("malformed backend pages fail closed rather than skipping subjects", () => {
  const s = subject("123456789");
  assert.throws(() => parsePushPage(response([{ s }, { s }]), response([])), /order/);
  assert.throws(() => parsePushPage(response(Array.from({ length: 22 }, () => ({ s }))), response([])), /subject response/);
  assert.throws(() => parsePushPage(response([{ s }]), response([row("https://evil.example", `${ns}publisher`, lit("origin_trail"))])), /metadata row/);
  assert.throws(() => parsePushPage(response([{ s }]), response([])), /Incomplete collective push metadata/);
  assert.throws(() => parsePushPage(response([{ s }]), response(details(s).slice(1))), /Incomplete collective push metadata/);
  assert.throws(() => parsePushPage(response([{ s }]), response(Array.from({ length: 400 }, () => details(s)[0]))), /Incomplete collective push metadata/);
  assert.throws(() => parsePushPage(response([{ s }]), {}), /Incomplete collective push metadata/);
  assert.equal(parsePushPage(response([{ s }]), response(details(s).map((r) => r.p === `${ns}publisher` ? { ...r, o: lit("stranger") } : r))).entries[0].verifiedOriginal, false);
});
