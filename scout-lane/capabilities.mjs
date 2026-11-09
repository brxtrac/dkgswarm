// Server-bound capability grants. Identity is the authenticated OAuth token
// family, never a caller-supplied id. Missing, malformed or revoked grants fail closed.
import { readFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";

const ROLES = new Set(["scout", "worker", "publisher", "operator"]);

export class CapabilityError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function loadGrants(path) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new CapabilityError("capabilities-unavailable", `scout capabilities unavailable: ${error.code || "read failed"}`); }
  const grants = Array.isArray(raw?.grants) ? raw.grants : [];
  const map = new Map();
  for (const grant of grants) {
    if (!grant || typeof grant.tokenFamily !== "string" || !grant.tokenFamily) continue;
    if (!Array.isArray(grant.roles) || grant.roles.some((role) => !ROLES.has(role))) continue;
    if (grant.revokedAt !== undefined && grant.revokedAt !== null) {
      const revoked = Date.parse(grant.revokedAt);
      if (!Number.isFinite(revoked) || revoked <= Date.now()) continue;
    }
    map.set(grant.tokenFamily, {
      id: typeof grant.id === "string" && grant.id ? grant.id : `grant-${createHash("sha256").update(grant.tokenFamily).digest("hex").slice(0, 12)}`,
      tokenFamily: grant.tokenFamily,
      roles: [...new Set(grant.roles)],
      accounts: Array.isArray(grant.accounts) ? grant.accounts.filter((a) => typeof a === "string" && a) : [],
      tokenEnv: typeof grant.tokenEnv === "string" ? grant.tokenEnv : null,
      revokedAt: grant.revokedAt || null,
    });
  }
  return map;
}

export function grantFor(auth, path) {
  if (!auth?.family) throw new CapabilityError("unauthenticated", "authenticated token family required");
  const grant = loadGrants(path).get(auth.family);
  if (!grant) throw new CapabilityError("forbidden", "no scout capability grant for this connection");
  if (!Array.isArray(grant.accounts) || grant.accounts.length === 0) throw new CapabilityError("no-account-scope", "capability grant has no approved account");
  return grant;
}

export function requireRole(auth, path, role) {
  const grant = grantFor(auth, path);
  if (!grant.roles.includes(role)) throw new CapabilityError("forbidden", `${role} capability required`);
  return grant;
}

export function requireRoles(auth, path, roles) {
  const grant = grantFor(auth, path);
  for (const role of roles) if (!grant.roles.includes(role)) throw new CapabilityError("forbidden", `${role} capability required`);
  return grant;
}

export function grantAllowsAccount(grant, account) {
  return Array.isArray(grant.accounts) && grant.accounts.includes(account);
}

export function sameToken(a, b) {
  const left = String(a ?? ""), right = String(b ?? "");
  return left.length === right.length && left.length > 0 && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function verifyLocalGrant(path, grantId, suppliedToken) {
  const grant = [...loadGrants(path).values()].find((row) => row.id === grantId);
  if (!grant) throw new CapabilityError("forbidden", "unknown local scout grant");
  if (!grant.roles.includes("scout")) throw new CapabilityError("forbidden", "scout capability required");
  if (!grant.accounts.length) throw new CapabilityError("no-account-scope", "local scout grant has no approved account");
  const expected = grant.tokenEnv ? process.env[grant.tokenEnv] : undefined;
  const supplied = String(suppliedToken ?? "");
  if (!expected || !supplied || expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    throw new CapabilityError("unauthorized", "invalid local scout credential");
  }
  return grant;
}
