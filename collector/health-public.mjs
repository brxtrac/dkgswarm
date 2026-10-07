import fs from "node:fs";

const LEVELS = new Set(["green", "yellow", "red"]);
const STALE_MS = 36 * 60 * 60 * 1000;

export function publicHealth(statusPath) {
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    const level = LEVELS.has(status.level) ? status.level : "red";
    const checkedAt = typeof status.checkedAt === "string" ? status.checkedAt : "";
    const ageMs = Date.parse(checkedAt);
    const stale = !Number.isFinite(ageMs) || Date.now() - ageMs > STALE_MS;
    return {
      level: stale ? "red" : level,
      ok: !stale && level !== "red",
      summary: stale ? "Health check is stale." : String(status.summary || "").slice(0, 180),
      checkedAt: stale ? "" : checkedAt,
    };
  } catch {
    return { level: "red", ok: false, summary: "Health check has not run.", checkedAt: "" };
  }
}
