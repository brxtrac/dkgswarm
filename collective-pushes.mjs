const BASE = "https://www.dkgswarm.com/ka/";
const NS = "https://www.dkgswarm.com/ontology/curator/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const PREDICATES = [
  `${NS}targetPost`, `${NS}publisher`, `${NS}sourceTier`,
  "https://schema.org/dateCreated", "https://schema.org/expires",
];
const ACCOUNTS = new Set(["drevziga", "branaRakic", "umanitek", "origin_trail"].map((value) => value.toLowerCase()));
const SUBJECT = /^https:\/\/www\.dkgswarm\.com\/ka\/(?:collective-push-x-\d{8,22}|curator-push-collective[-_]?push[-_][a-zA-Z0-9._-]{1,80})$/i;
const PAGE_SIZE = 20;
const METADATA_LIMIT = PAGE_SIZE * PREDICATES.length * 4;
const XSD_DATETIME = "http://www.w3.org/2001/XMLSchema#dateTime";
const CURSOR_MAX_AGE_MS = 60 * 60 * 1000;

function term(value) {
  return typeof value === "string" ? value : value?.value;
}

function literal(value) {
  const raw = term(value);
  if (typeof raw !== "string" || raw.length > 1024 || !raw.startsWith('"')) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : null;
  } catch { return null; }
}

function validSubject(subject) {
  return typeof subject === "string" && SUBJECT.test(subject) && subject.length <= 160;
}

function decodeCursor(cursor, now) {
  if (cursor === undefined) return { asOf: now, after: null };
  if (typeof cursor !== "string" || cursor.length > 400 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("Invalid collective push cursor");
  let data;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(raw).toString("base64url") !== cursor) throw new Error();
    data = JSON.parse(raw);
  } catch { throw new Error("Invalid collective push cursor"); }
  if (data?.v !== 1 || !Number.isSafeInteger(data.asOf) || data.asOf > now || now - data.asOf > CURSOR_MAX_AGE_MS || !validSubject(data.after)) throw new Error("Expired or invalid collective push cursor; restart without cursor");
  return data;
}

function encodeCursor(asOf, after) {
  return Buffer.from(JSON.stringify({ v: 1, asOf, after })).toString("base64url");
}

export function pushBindings(response) {
  return response?.bindings ?? response?.result?.bindings;
}

export function pushSubjectQuery(cursor, now = Date.now()) {
  const { asOf, after } = decodeCursor(cursor, now);
  const cutoff = new Date(asOf).toISOString();
  return `SELECT DISTINCT ?s WHERE { ?s <${RDF_TYPE}> <${NS}CollectivePush> . ?s <https://schema.org/expires> ?expiry . FILTER(<${XSD_DATETIME}>(STR(?expiry)) > "${cutoff}"^^<${XSD_DATETIME}>) FILTER(REGEX(STR(?s), "^https://www[.]dkgswarm[.]com/ka/(collective-push-x-[0-9]{8,22}|curator-push-collective[-_]?push[-_][a-zA-Z0-9._-]{1,80})$", "i"))${after ? ` FILTER(STR(?s) < "${after}")` : ""} } ORDER BY DESC(?s) LIMIT ${PAGE_SIZE + 1}`;
}

export function pushMetadataQuery(subjects) {
  if (!Array.isArray(subjects) || !subjects.length || subjects.length > PAGE_SIZE || subjects.some((s) => !validSubject(s))) throw new Error("Invalid collective push subjects");
  return `SELECT ?s ?p ?o WHERE { VALUES ?s { ${subjects.map((s) => `<${s}>`).join(" ")} } ?s ?p ?o . FILTER(?p IN (${PREDICATES.map((p) => `<${p}>`).join(", ")})) } LIMIT ${METADATA_LIMIT}`;
}

export function parsePushPage(subjectResponse, metadataResponse, cursor, now = Date.now()) {
  const { asOf, after } = decodeCursor(cursor, now);
  const rows = pushBindings(subjectResponse);
  if (!Array.isArray(rows) || rows.length > PAGE_SIZE + 1) throw new Error("Invalid collective push subject response");
  const subjects = rows.map((row) => term(row.s));
  if (subjects.some((s, i) => !validSubject(s) || (after && s >= after) || (i && s >= subjects[i - 1]))) throw new Error("Invalid collective push subject order");
  const page = subjects.slice(0, PAGE_SIZE);
  const metadata = pushBindings(metadataResponse);
  if (!Array.isArray(metadata) || metadata.length >= METADATA_LIMIT) throw new Error("Incomplete collective push metadata response");
  const fields = new Map(page.map((s) => [s, new Map()]));
  for (const row of metadata) {
    const s = term(row.s);
    const p = term(row.p);
    if (!fields.has(s) || !PREDICATES.includes(p)) throw new Error("Invalid collective push metadata row");
    const values = fields.get(s).get(p) || [];
    values.push(term(row.o));
    fields.get(s).set(p, values);
  }
  const entries = page.map((subject) => {
    if (PREDICATES.some((predicate) => !fields.get(subject).has(predicate))) throw new Error("Incomplete collective push metadata response");
    const get = (predicate, asLiteral = false) => {
      const values = fields.get(subject).get(predicate) || [];
      return values.length === 1 ? (asLiteral ? literal(values[0]) : values[0]) : null;
    };
    const targetPost = get(`${NS}targetPost`);
    const publisher = get(`${NS}publisher`, true);
    const sourceTier = get(`${NS}sourceTier`, true);
    const issuedAt = get("https://schema.org/dateCreated", true);
    const expiresAt = get("https://schema.org/expires", true);
    const direct = subject.startsWith(`${BASE}collective-push-x-`);
    const id = direct ? subject.match(/(\d{8,22})$/)?.[1] : targetPost?.match(/^https:\/\/x\.com\/i\/status\/(\d{8,22})$/)?.[1];
    const valid = Boolean(id) && targetPost === `https://x.com/i/status/${id}`
      && typeof publisher === "string" && publisher.length <= 80
      && typeof issuedAt === "string" && Number.isFinite(Date.parse(issuedAt))
      && typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt))
      && Date.parse(expiresAt) > Date.parse(issuedAt)
      && (direct ? sourceTier === "trusted-source-direct" && ACCOUNTS.has(publisher.replace(/^@/, "").toLowerCase())
        : sourceTier === "authenticated-writer-directive");
    return valid ? { subject, targetPost, publisher, issuedAt, expiresAt, category: direct ? "watcher-namespace" : "curated-namespace", verifiedOriginal: false, expired: Date.parse(expiresAt) <= now }
      : { subject, category: "unverified-metadata", verifiedOriginal: false };
  });
  return { entries, nextCursor: subjects.length > PAGE_SIZE ? encodeCursor(asOf, page.at(-1)) : null, complete: subjects.length <= PAGE_SIZE };
}

export const collectivePushPageSize = PAGE_SIZE;
