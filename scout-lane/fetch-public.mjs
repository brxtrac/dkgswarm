// Bounded public fetch: URL validation, DNS pinning, manual redirects, size cap.
import https from "node:https";
import { lookup as dnsLookup } from "node:dns";
import { canonicalPublicUrl } from "./jobs.mjs";

export class PublicFetchError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function isPublicAddress(address) {
  if (!address || typeof address !== "string") return false;
  if (address.includes(":")) {
    const a = address.toLowerCase().split("%")[0];
    if (a === "::" || a === "::1") return false;
    if (/^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a)) return false;
    if (a.startsWith("::ffff:")) return isPublicAddress(a.slice(7));
    if (/^2001:db8:/.test(a)) return false;
    return true;
  }
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

function defaultLookup(hostname) {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, rows) => {
      if (error) reject(new PublicFetchError("dns", "public source DNS lookup failed"));
      else resolve(rows.map((row) => row.address));
    });
  });
}

export function createPinnedLookup(address) {
  const family = address.includes(":") ? 6 : 4;
  return (_host, options, callback) => {
    if (options?.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

export function defaultRequest(url, address, { timeoutMs, maxBytes, rejectUnauthorized = true }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: "https:",
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || 443),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { "user-agent": "dkgswarm-scout/1.0", accept: "text/html,text/plain,application/json;q=0.9" },
      servername: url.hostname.replace(/^\[|\]$/g, ""),
      lookup: createPinnedLookup(address),
      rejectUnauthorized,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new PublicFetchError("too-large", "public source exceeds size limit")); return; }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new PublicFetchError("timeout", "public source timed out")));
    req.on("error", (error) => reject(error instanceof PublicFetchError ? error : new PublicFetchError("network", "public source fetch failed")));
    req.end();
  });
}

export async function fetchPublicSource(url, {
  requestImpl = defaultRequest, lookupImpl = defaultLookup,
  timeoutMs = 8_000, maxBytes = 256 * 1024, maxRedirects = 3, now = Date.now(),
} = {}) {
  let current = canonicalPublicUrl(url, { requireFetchable: true });
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = new URL(current);
    const raw = await lookupImpl(parsed.hostname);
    const addresses = (Array.isArray(raw) ? raw : [raw]).map((row) => typeof row === "string" ? row : row?.address);
    const address = addresses.find(isPublicAddress);
    if (!address) throw new PublicFetchError("private-dns", "public source resolves to a private address");
    const response = await requestImpl(parsed, address, { timeoutMs, maxBytes });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers?.location;
      if (!location) throw new PublicFetchError("redirect", "redirect without location");
      current = canonicalPublicUrl(new URL(location, current).href, { requireFetchable: true });
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) throw new PublicFetchError("status", `public source returned ${response.statusCode}`);
    if (response.body && Buffer.byteLength(response.body) > maxBytes) throw new PublicFetchError("too-large", "public source exceeds size limit");
    return { url: current, status: response.statusCode, contentType: String(response.headers?.["content-type"] || ""), body: String(response.body || ""), fetchedAt: now };
  }
  throw new PublicFetchError("redirect-limit", "too many redirects");
}
