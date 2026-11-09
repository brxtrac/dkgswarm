// Sanitized public summary representation for the trac-marketing/scout-jobs
// sub-graph. Never authoritative and never contains private account identity.
import { createHash } from "node:crypto";
import { canonicalPublicUrl, queryHasSecret } from "./jobs.mjs";

const NS = "https://www.dkgswarm.com/ontology/scout/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SECRET_TEXT = /(?:password|passwd|secret|bearer\s+[a-z0-9._-]{10,}|\b(?:sk|pk|ghp|xox[baprs])[-_][a-z0-9]{10,})/i;

export function sanitizeSummaryTopic(value) {
  const topic = String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (topic.length < 3) throw new Error("summary topic is too short");
  if (SECRET_TEXT.test(topic)) throw new Error("summary topic contains credential-like material");
  return topic;
}

export function mirrorPayload(job) {
  const topic = sanitizeSummaryTopic(job.topic);
  const publicId = createHash("sha256").update(job.id).digest("hex").slice(0, 20);
  const subject = `${NS}job/${publicId}`;
  const status = {
    queued: "PotentialActionStatus", claimed: "ActiveActionStatus", submitting: "ActiveActionStatus",
    draft: "ActiveActionStatus", published: "CompletedActionStatus", failed: "FailedActionStatus",
    skipped: "FailedActionStatus", uncertain: "PotentialActionStatus", expired: "FailedActionStatus",
  }[job.state] || "PotentialActionStatus";
  const quad = (predicate, object) => ({ subject, predicate, object });
  const literal = (value) => JSON.stringify(String(value));
  const quads = [
    quad(RDF_TYPE, "https://schema.org/PlanAction"),
    quad("https://schema.org/identifier", literal(publicId)),
    quad("https://schema.org/name", literal(topic)),
    quad("https://schema.org/actionStatus", `https://schema.org/${status}`),
    quad(`${NS}platform`, literal(job.platform)),
    quad(`${NS}action`, literal(job.action)),
    quad("https://schema.org/startTime", literal(new Date(job.createdAt).toISOString())),
    quad("https://schema.org/endTime", literal(new Date(job.updatedAt).toISOString())),
  ];
  if (job.targetUrl) quads.push(quad("https://schema.org/target", canonicalPublicUrl(job.targetUrl)));
  if (job.resultUrl) quads.push(quad("https://schema.org/url", canonicalPublicUrl(job.resultUrl)));
  for (const source of (job.provenance?.sources || []).slice(0, 3)) {
    const url = canonicalPublicUrl(source.url);
    if (queryHasSecret(url)) throw new Error("summary source contains credential-like query material");
    quads.push(quad("https://schema.org/citation", url));
  }
  return { name: `scout-job-${publicId}`, subject, subGraphName: "scout-jobs", quads };
}
