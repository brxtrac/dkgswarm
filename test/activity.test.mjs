import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createActivity } from "../activity.mjs";

test("counts all-time installations and calls without exposing identities or counting pings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-activity-"));
  const activity = createActivity(path.join(dir, "activity.sqlite"));
  try {
    const at = Date.now();
    activity.record({ family: "agent-a", tool: "query_graph", graph: "trac-marketing", ok: true, at });
    activity.record({ family: "agent-a", tool: "search_graph", graph: "trac-marketing", ok: true, at });
    activity.record({ family: "agent-b", tool: "write_working_memory", graph: "trac-marketing", ok: false, at });
    activity.record({ family: "agent-old", tool: "query_graph", graph: "trac-marketing", ok: true, at: at - 90000000 });
    activity.record({ family: "idle-client", tool: "ping", graph: "trac-marketing", ok: true, at });
    const snapshot = activity.snapshot(at);
    assert.equal(snapshot.connectedInstallations, 3);
    assert.equal(snapshot.queries, 3);
    assert.equal(snapshot.contributionAttempts, 1);
    assert.equal(snapshot.toolCalls, 4);
    assert.doesNotMatch(JSON.stringify(snapshot), /agent-a|agent-b/);
  } finally {
    activity.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
