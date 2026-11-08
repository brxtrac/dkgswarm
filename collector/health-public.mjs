import fs from "node:fs";

const LEVELS = new Set(["green", "yellow", "red"]);
const STALE_MS = 36 * 60 * 60 * 1000;

export function publicHealth(statusPath, collector) {
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    let level = LEVELS.has(status.level) ? status.level : "red";
    let summary = String(status.summary || "").slice(0, 180);
    if (collector) {
      const poll = Date.parse(collector.lastPoll);
      if (!Number.isFinite(poll) || Date.now() - poll > 15 * 60000 || collector.lastError) {
        level = "red";
        summary = "Collector polling is stale or degraded.";
      } else if (collector.dkgFailures?.length && level === "green") {
        level = "yellow";
        summary = "Collector deliveries are quarantined; manual review required.";
      } else if (collector.searchReady && (!Number.isFinite(Date.parse(collector.lastSearch)) || Date.now() - Date.parse(collector.lastSearch) > 30 * 60000) && level === "green") {
        level = "yellow";
        summary = "Collector search is stale or unknown.";
      }
    }
    const checkedAt = typeof status.checkedAt === "string" ? status.checkedAt : "";
    const ageMs = Date.parse(checkedAt);
    const stale = !Number.isFinite(ageMs) || Date.now() - ageMs > STALE_MS || ageMs > Date.now() + 60000;
    return {
      level: stale ? "red" : level,
      ok: !stale && level !== "red",
      summary: stale ? "Health check is stale." : summary,
      checkedAt: stale ? "" : checkedAt,
    };
  } catch {
    return { level: "red", ok: false, summary: "Health check has not run.", checkedAt: "" };
  }
}
