// Worker context: job brief is authoritative local data; graph text is untrusted context.
import { postingContextMetaQuery, postingContextSearchQuery, rankPostingContext } from "../posting-context.mjs";

export async function fetchWorkerContext({ job, config, endpoint, token, fetchImpl = fetch, now = Date.now(), timeoutMs = 10_000 }) {
  if (!endpoint || !token) throw new Error("worker context requires DKG endpoint and token");
  const query = async (sparql) => {
    const response = await fetchImpl(`${endpoint.replace(/\/$/, "")}/api/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sparql, contextGraphId: config.graph.contextGraphId, view: config.graph.view }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`DKG context query failed: ${response.status}`);
    const payload = await response.json();
    return payload?.result?.bindings ?? [];
  };
  const textRows = await query(postingContextSearchQuery(job.topic));
  const subjects = [...new Set(textRows.map((row) => row.s).filter((s) => typeof s === "string" && s.startsWith("https://")))].slice(0, 80);
  const metaRows = subjects.length ? await query(postingContextMetaQuery(subjects)) : [];
  return {
    contextGraphId: config.graph.contextGraphId,
    view: config.graph.view,
    untrusted: true,
    jobBrief: job.brief,
    provenance: job.provenance,
    packet: rankPostingContext({
      topic: job.topic,
      action: job.action,
      targetUrl: job.targetUrl,
      textRows,
      metaRows,
      now,
    }),
  };
}
