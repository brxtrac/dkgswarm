// Public read-only mirror representation for the trac-marketing sub-graph.
// The transactional ledger stays in SQLite; this payload is never authoritative.
import { createHash } from "node:crypto";

const NS = "https://www.dkgswarm.com/ontology/scout/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export function mirrorPayload(job) {
  const publicId = createHash("sha256").update(job.id).digest("hex").slice(0, 20);
  const subject = `${NS}job/${publicId}`;
  const status = {
    queued: "PotentialActionStatus",
    claimed: "ActiveActionStatus",
    draft: "ActiveActionStatus",
    completed: "CompletedActionStatus",
    published: "CompletedActionStatus",
    failed: "FailedActionStatus",
    skipped: "FailedActionStatus",
    uncertain: "PotentialActionStatus",
    expired: "FailedActionStatus",
  }[job.state] || "PotentialActionStatus";
  const quad = (predicate, object) => ({ subject, predicate, object });
  const literal = (value) => JSON.stringify(String(value));
  const quads = [
    quad(RDF_TYPE, "https://schema.org/PlanAction"),
    quad("https://schema.org/identifier", literal(publicId)),
    quad("https://schema.org/name", literal(job.topic)),
    quad("https://schema.org/actionStatus", `https://schema.org/${status}`),
    quad(`${NS}platform`, literal(job.platform)),
    quad(`${NS}action`, literal(job.action)),
    quad("https://schema.org/startTime", literal(new Date(job.createdAt).toISOString())),
    quad("https://schema.org/endTime", literal(new Date(job.updatedAt).toISOString())),
  ];
  if (job.targetUrl) quads.push(quad("https://schema.org/target", job.targetUrl));
  if (job.resultUrl) quads.push(quad("https://schema.org/url", job.resultUrl));
  if (job.provenance?.sources?.length) {
    for (const source of job.provenance.sources.slice(0, 3)) quads.push(quad("https://schema.org/citation", source.url));
  }
  // Deliberately absent: account scope, brief, worker identity, leases, fencing tokens.
  return { name: `scout-job-${publicId}`, subject, subGraphName: "scout-jobs", quads };
}
