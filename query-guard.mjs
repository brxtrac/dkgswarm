export function assertReadSparql(sparql) {
  const s = String(sparql || "").trim();
  if (!s || s.length > 4096) throw new Error("SPARQL missing or exceeds 4096 characters");
  // Small explicit subset: one triple, fixed predicate, no joins, paths,
  // aggregates, functions, aliases, graph clauses, or arbitrary expressions.
  const pattern = /^(SELECT\s+(?:\?[A-Za-z][\w]*\s+){1,3}WHERE\s*\{|ASK\s*\{)\s*(\?[A-Za-z][\w]*|<https:\/\/www\.dkgswarm\.com\/ka\/[a-zA-Z0-9._-]+>)\s+<(https?:\/\/[^<>\s]+)>\s+(\?[A-Za-z][\w]*|<https?:\/\/[^<>\s]+>)\s*\.?\s*\}\s*(?:LIMIT\s+(\d{1,3})(?:\s+OFFSET\s+(\d{1,5}))?)?$/i;
  const match = pattern.exec(s);
  if (!match) throw new Error("Only a single bounded triple-pattern SELECT or ASK is allowed");
  const select = /^SELECT/i.test(match[1]);
  if (select && (!match[5] || Number(match[5]) < 1 || Number(match[5]) > 100)) throw new Error("SELECT requires LIMIT between 1 and 100");
  if (match[6] && Number(match[6]) > 10000) throw new Error("OFFSET exceeds 10000");
  if (match[3] === "http://www.w3.org/2000/01/rdf-schema#comment" && match[2].startsWith("?")) {
    throw new Error("Broad policy text reads unavailable; use search_graph or get_swarm_policy");
  }
  if (/swarm-policy-v/i.test(match[2]) || /swarm-policy-v/i.test(match[4])) throw new Error("Use get_swarm_policy for owner policy");
  return s;
}
