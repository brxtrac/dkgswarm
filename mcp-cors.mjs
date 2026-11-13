// Origin policy for the MCP endpoint. Browsers send Origin on cross-origin requests;
// non-browser clients usually send none. Only configured origins are reflected.
const DEFAULT_ORIGINS = [
  "https://claude.ai",
  "https://claude.com",
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://grok.com",
  "https://x.ai",
  "https://cursor.com",
  "https://www.cursor.com",
];

function originList(value) {
  if (!value) return DEFAULT_ORIGINS;
  return value.split(",").map((item) => {
    try {
      const url = new URL(item.trim());
      return ["http:", "https:"].includes(url.protocol) && url.pathname === "/" ? url.origin : null;
    } catch {
      return null;
    }
  }).filter(Boolean);
}

const ALLOWED_ORIGINS = new Set(originList(process.env.DKG_MCP_CORS_ORIGINS));

export function isCorsOriginAllowed(origin) {
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (["127.0.0.1", "localhost", "::1"].includes(host)) return true;
  return ALLOWED_ORIGINS.has(url.origin);
}

export function mcpCors(req, res, next) {
  res.set("Vary", "Origin");
  const origin = req.get("origin");
  if (origin && !isCorsOriginAllowed(origin)) {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }
  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id");
  }
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, Last-Event-ID, Mcp-Session-Id");
    res.set("Access-Control-Max-Age", "600");
    res.status(204).end();
    return;
  }
  next();
}
