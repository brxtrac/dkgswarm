import { createHash, timingSafeEqual } from "node:crypto";

// The digest is pinned outside the graph. A graph writer cannot change trusted policy bytes.
export function policyDigest(policy) {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

export function verifyPolicyBindings(bindings, { version, sha256, contextGraphId }) {
  if (!Number.isSafeInteger(version) || version < 1 || !/^[a-f0-9]{64}$/.test(sha256 || "")) {
    throw new Error("Owner policy integrity pin missing or invalid");
  }
  if (!Array.isArray(bindings) || bindings.length !== 1 || typeof bindings[0]?.o !== "string") {
    throw new Error("Owner policy unavailable or ambiguous in Shared Working Memory");
  }
  let policy;
  try { policy = JSON.parse(JSON.parse(bindings[0].o)); }
  catch { throw new Error("Owner policy malformed in Shared Working Memory"); }
  if (policy?.kind !== "swarm-coordination-policy" || policy.version !== version || policy.contextGraphId !== contextGraphId) {
    throw new Error("Owner policy identity mismatch");
  }
  const actual = Buffer.from(policyDigest(policy), "hex");
  const expected = Buffer.from(sha256, "hex");
  if (!timingSafeEqual(actual, expected)) throw new Error("Owner policy integrity mismatch");
  return policy;
}
