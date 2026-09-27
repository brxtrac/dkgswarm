export function assertReadSparql(sparql) {
  const s = String(sparql || "").trim();
  if (!s) throw new Error("sparql is required");
  if (s.length > 4096) throw new Error("SPARQL exceeds 4096 characters");
  if (!/^(PREFIX\s+\S+\s*<[^>]+>\s*)*(SELECT|ASK)\b/i.test(s)) {
    throw new Error("Only SELECT or ASK queries are allowed");
  }
  if (/\b(INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|MOVE|COPY|ADD|UPDATE|SERVICE|CONSTRUCT|DESCRIBE)\b/i.test(s)) {
    throw new Error("SPARQL operation unavailable on this connector");
  }
  const limits = [...s.matchAll(/\bLIMIT\s+(\d+)\b/gi)];
  if (/\bSELECT\b/i.test(s) && (limits.length !== 1 || Number(limits[0][1]) > 100 || Number(limits[0][1]) < 1)) throw new Error("SELECT requires LIMIT between 1 and 100");
  const offsets = [...s.matchAll(/\bOFFSET\s+(\d+)\b/gi)];
  if (offsets.length > 1 || offsets.some((match) => Number(match[1]) > 10000)) throw new Error("OFFSET exceeds 10000");
  return s;
}
