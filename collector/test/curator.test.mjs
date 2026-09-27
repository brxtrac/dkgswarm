import test from "node:test";
import assert from "node:assert/strict";
import { askTrue, canonicalUrl, validateCollectivePush } from "../curator.mjs";

test("canonical URL strips tracking and normalizes X post identity", () => {
  assert.equal(canonicalUrl("http://www.example.org/story/?utm_source=x&b=2&a=1#part"), "https://example.org/story?a=1&b=2");
  assert.equal(canonicalUrl("https://twitter.com/SomeUser/status/123456789?ref_src=feed"), "https://x.com/i/status/123456789");
  assert.equal(canonicalUrl("https://x.com/i/status/123456789/"), "https://x.com/i/status/123456789");
});

test("DKG ASK result format confirms queryable SWM content", () => {
  assert.equal(askTrue({ result: { type: "boolean", value: true, bindings: [{ result: "true" }] } }), true);
  assert.equal(askTrue({ result: { type: "boolean", value: false } }), false);
});

test("valid writer push remains separate from source evidence and has bounded expiry", () => {
  const push = { name: "collective-push-demo", url: "https://x.com/Author/status/123456789", postId: "123456789", publisher: "@Author",
    issuedAt: "2026-09-25T10:00:00Z", expiresAt: "2026-09-25T12:00:00Z", angle: "Explain DKG context", text: "Campaign guidance with enough detail to establish intent." };
  assert.equal(validateCollectivePush(push, Date.parse("2026-09-25T11:00:00Z")), "https://x.com/i/status/123456789");
  assert.throws(() => validateCollectivePush(push, Date.parse("2026-09-25T12:00:00Z")), /expired/);
  assert.throws(() => validateCollectivePush({ ...push, postId: "987654321" }, Date.parse("2026-09-25T11:00:00Z")), /target URL/);
});
