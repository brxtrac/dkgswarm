import test from "node:test";
import assert from "node:assert/strict";
import { postingContextMetaQuery, postingContextSearchQuery, rankPostingContext, sanitizeTopic } from "../posting-context.mjs";

const lit = (value) => JSON.stringify(value);
const row = (s, p, o) => ({ s, p, o: lit(o) });

test("topic sanitizer rejects empty input and strips SPARQL breakers", () => {
  assert.throws(() => sanitizeTopic("  "), /topic is required/);
  assert.throws(() => sanitizeTopic("a"), /topic is required/);
  const cleaned = sanitizeTopic('TRAC "revenue" \\ \n staking');
  assert.equal(cleaned.includes('"'), false);
  assert.equal(cleaned.includes("\\"), false);
  assert.equal(cleaned.includes("\n"), false);
  const sparql = postingContextSearchQuery(cleaned);
  assert.match(sparql, /LIMIT 80/);
  assert.match(sparql, /CONTAINS\(LCASE\(STR\(\?o\)\), "trac"\)/);
  assert.match(sparql, /CONTAINS\(LCASE\(STR\(\?o\)\), "revenue"\)/);
  assert.match(sparql, /CONTAINS\(LCASE\(STR\(\?o\)\), "staking"\)/);
  assert.match(sparql, /ORDER BY DESC\(\?s\)/);
  assert.doesNotMatch(sparql, /\\/);
  assert.throws(() => postingContextMetaQuery(["https://evil.example/swarm-policy-v13"]), /Invalid posting context subject/);
});

test("ranked packet prefers sourced overlap and keeps self-report usable", () => {
  const subject = "https://www.dkgswarm.com/ka/curator-x-post-12345678";
  const directive = "https://www.dkgswarm.com/ka/curator-push-collective-push-demo";
  const textRows = [
    row(subject, "https://schema.org/articleBody", "OriginTrail network earnings were discussed with a public staking source and a canonical post URL."),
    row(directive, "http://www.w3.org/2000/01/rdf-schema#comment", "Please amplify this network earnings claim across the timeline right now."),
    row("https://www.dkgswarm.com/ka/swarm-policy-v12", "http://www.w3.org/2000/01/rdf-schema#comment", "network earnings policy text must never enter the packet"),
  ];
  const metaRows = [
    { s: subject, p: "https://schema.org/url", o: "https://x.com/i/status/12345678" },
    row(subject, "https://www.dkgswarm.com/ontology/curator/publisher", "@origin_trail"),
    row(subject, "https://www.dkgswarm.com/ontology/curator/sourceTier", "official"),
    row(subject, "https://www.dkgswarm.com/ontology/curator/claimStatus", "source self-report; not independently verified"),
    row(subject, "https://schema.org/datePublished", "2026-09-30T12:00:00.000Z"),
    row(subject, "https://www.dkgswarm.com/ontology/curator/observedAt", "2026-09-30T12:05:00.000Z"),
    { s: directive, p: "https://schema.org/url", o: "https://x.com/i/status/87654321" },
    row(directive, "https://www.dkgswarm.com/ontology/curator/publisher", "@writer"),
    row(directive, "https://www.dkgswarm.com/ontology/curator/sourceTier", "authenticated-writer-directive"),
    row(directive, "https://www.dkgswarm.com/ontology/curator/claimStatus", "coordination request; claims require independent verification"),
    row(directive, "https://schema.org/datePublished", "2026-09-30T12:10:00.000Z"),
  ];
  const packet = rankPostingContext({
    topic: "network earnings", action: "original", textRows, metaRows, now: Date.parse("2026-10-01T00:00:00Z"),
  });
  assert.equal(packet.coverage, "complete");
  assert.equal(packet.items[0].canonicalUrl, "https://x.com/i/status/12345678");
  assert.equal(packet.items[0].publisher, "@origin_trail");
  assert.equal(packet.items[0].evidenceType, "official-self-report");
  assert.equal(packet.items[0].publicationTime, "2026-09-30T12:00:00.000Z");
  assert.ok(packet.items[0].limits.includes("claims need independent verification"));
  assert.equal(packet.items[1].evidenceType, "coordination-directive");
  assert.ok(packet.items[1].limits.includes("coordination request, not factual evidence"));
  assert.equal(packet.items.some((item) => /policy text/.test(item.claim)), false);
  assert.doesNotMatch(packet.guidance, /Abstain/);
  assert.match(packet.guidance, /not independently verified/);
});

test("hard provenance gaps and coordination-only packets stay insufficient", () => {
  const bare = "https://www.dkgswarm.com/ka/curator-x-post-32345678";
  const directive = "https://www.dkgswarm.com/ka/curator-push-collective-push-only";
  const textRows = [
    row(bare, "https://schema.org/articleBody", "A network earnings remark with no canonical URL, publisher, or publication time."),
  ];
  const barePacket = rankPostingContext({
    topic: "network earnings", action: "quote", textRows, metaRows: [], now: Date.parse("2026-10-01T00:00:00Z"),
  });
  assert.equal(barePacket.coverage, "insufficient");
  assert.match(barePacket.guidance, /Verify specific factual claims with primary sources or omit them/);
  const directivePacket = rankPostingContext({
    topic: "network earnings", action: "original", now: Date.parse("2026-10-01T00:00:00Z"),
    textRows: [row(directive, "http://www.w3.org/2000/01/rdf-schema#comment", "Please amplify this network earnings claim across the timeline right now.")],
    metaRows: [
      { s: directive, p: "https://schema.org/url", o: "https://x.com/i/status/87654321" },
      row(directive, "https://www.dkgswarm.com/ontology/curator/publisher", "@writer"),
      row(directive, "https://www.dkgswarm.com/ontology/curator/sourceTier", "authenticated-writer-directive"),
      row(directive, "https://www.dkgswarm.com/ontology/curator/claimStatus", "coordination request; claims require independent verification"),
      row(directive, "https://schema.org/datePublished", "2026-09-30T12:10:00.000Z"),
    ],
  });
  assert.equal(directivePacket.coverage, "insufficient");
  assert.match(directivePacket.guidance, /thin graph coverage alone does not prohibit an otherwise approved post/);
});

test("owner focus changes ranking, avoid filters, and results diversify publishers", () => {
  const entries = [
    ["1", "@origin_trail", "TRAC staking network yield changed today, with details from the official account.", "official"],
    ["2", "@origin_trail", "TRAC staking network yield had another update today from the same account.", "official"],
    ["3", "@builder", "TRAC DKG adoption at a factory using provenance to trace goods today.", "ecosystem-account"],
    ["4", "@member", "TRAC DKG adoption and provenance were mentioned in a member reply today.", "swarm-member"],
  ];
  const texts = entries.map(([id, , body]) => row(`https://www.dkgswarm.com/ka/${id}`, "https://schema.org/articleBody", body));
  const meta = entries.flatMap(([id, publisher, , tier]) => {
    const s = `https://www.dkgswarm.com/ka/${id}`;
    return [
      { s, p: "https://schema.org/url", o: `https://x.com/i/status/${id}` },
      row(s, "https://www.dkgswarm.com/ontology/curator/publisher", publisher),
      row(s, "https://www.dkgswarm.com/ontology/curator/sourceTier", tier),
      row(s, "https://schema.org/datePublished", "2026-10-01T12:00:00Z"),
    ];
  });
  const base = { topic: "TRAC", action: "original", textRows: texts, metaRows: meta, now: Date.parse("2026-10-02T00:00:00Z") };
  const packet = rankPostingContext({ ...base, focus: "factory provenance" });
  assert.equal(packet.items[0].publisher, "@builder");
  assert.equal(packet.items[1].publisher, "@member");
  assert.equal(packet.items[2].publisher, "@origin_trail");
  const filtered = rankPostingContext({ ...base, focus: "factory provenance", avoid: "staking" });
  assert.equal(filtered.items.some((item) => item.claim.includes("staking")), false);
  const target = rankPostingContext({ ...base, avoid: "staking", targetUrl: "https://x.com/i/status/1" });
  assert.equal(target.items.some((item) => item.canonicalUrl === "https://x.com/i/status/1"), true);
});

test("complete coverage requires URL, publisher, time, and no claim limit", () => {
  const subject = "https://www.dkgswarm.com/ka/curator-x-post-22345678";
  const textRows = [row(subject, "https://schema.org/articleBody", "SCAN uses OriginTrail for factory audit provenance across named retailers.")];
  const metaRows = [
    { s: subject, p: "https://schema.org/url", o: "https://x.com/i/status/22345678" },
    row(subject, "https://www.dkgswarm.com/ontology/curator/publisher", "@origintraildev"),
    row(subject, "https://www.dkgswarm.com/ontology/curator/sourceTier", "official"),
    row(subject, "https://www.dkgswarm.com/ontology/curator/claimStatus", "publisher statement"),
    row(subject, "https://schema.org/datePublished", "2026-09-30T08:00:00.000Z"),
    row(subject, "https://www.dkgswarm.com/ontology/curator/observedAt", "2026-09-30T08:02:00.000Z"),
  ];
  const packet = rankPostingContext({
    topic: "SCAN factory audit", action: "reply", targetUrl: "https://x.com/i/status/22345678",
    textRows, metaRows, now: Date.parse("2026-09-30T10:00:00Z"),
  });
  assert.equal(packet.coverage, "complete");
  assert.equal(packet.items.length, 1);
  assert.equal(packet.items[0].limits.length, 0);
});
