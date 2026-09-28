import { createHash } from 'node:crypto';

const KA = 'https://www.dkgswarm.com/ka/';
const literal = (value) => {
  if (typeof value === 'object' && value !== null) value = value.value;
  if (typeof value !== 'string') return '';
  if (value.startsWith('"')) { try { return JSON.parse(value); } catch { return value.replace(/^"|"$/g, ''); } }
  return value;
};
const safeUrl = (value) => {
  try { const url = new URL(literal(value)); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
};

// Curated SWM only. Exclude owner policies, unreviewed drafts and game/score records.
export function makeGamePack(bindings, { asOf = new Date().toISOString(), graph = 'trac-marketing' } = {}) {
  const entries = new Map();
  const sorted = [...bindings].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const row of sorted) {
    const id = literal(row.s);
    if (!id.startsWith(KA) || /swarm-policy|game-score|game-run/i.test(id)) continue;
    const text = literal(row.text || row.body || row.comment).trim();
    if (text.length < 60 || text.length > 16000) continue;
    const prev = entries.get(id);
    const source = safeUrl(row.url || row.source);
    // Keep one record per subject; don't manufacture multiple independent sources from repeated bindings.
    entries.set(id, {
      id, title: literal(row.label).slice(0, 140) || id.slice(KA.length).replaceAll('-', ' '),
      excerpt: text.slice(0, 850), source: source || prev?.source || null,
      tier: literal(row.tier).slice(0, 90) || prev?.tier || null,
      status: literal(row.status).slice(0, 100) || prev?.status || null,
      observed: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(literal(row.observed)) ? literal(row.observed).slice(0, 40) : prev?.observed || null,
      target: safeUrl(row.target) || prev?.target || null,
      kind: /collective.push/i.test(id) ? 'directive' : 'evidence',
    });
  }
  const records = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 240);
  const snapshot = { version: 1, graph, layer: 'shared-working-memory', asOf, entries: records };
  return { ...snapshot, hash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
}

export const GAME_QUERY = `SELECT ?s ?label ?text ?url ?tier ?status ?observed ?target WHERE {
  VALUES ?contentPredicate { <http://www.w3.org/2000/01/rdf-schema#comment> <https://schema.org/articleBody> }
  ?s ?contentPredicate ?text .
  OPTIONAL { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?label }
  OPTIONAL { ?s <https://schema.org/url> ?url }
  OPTIONAL { ?s <https://www.dkgswarm.com/ontology/curator/sourceTier> ?tier }
  OPTIONAL { ?s <https://www.dkgswarm.com/ontology/curator/claimStatus> ?status }
  OPTIONAL { ?s <https://www.dkgswarm.com/ontology/curator/observedAt> ?observed }
  OPTIONAL { ?s <https://www.dkgswarm.com/ontology/curator/targetPost> ?target }
  FILTER(STRSTARTS(STR(?s), "https://www.dkgswarm.com/ka/"))
  FILTER(!CONTAINS(STR(?s), "/swarm-policy-v"))
} ORDER BY DESC(?s) LIMIT 100 OFFSET `;
