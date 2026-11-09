import { beginSubmitCore, claimCore, loadConfig } from "../jobs.mjs";

const [dbPath, configPath, workerId, now, mode] = process.argv.slice(2);
const config = loadConfig(configPath, { now: Number(now) });
const claimed = claimCore({ dbPath, config, workerId, accounts: ["acct-1"], now: Number(now) });
if (!claimed.claimed) process.exit(3);
if (mode === "after") {
  const begun = beginSubmitCore({ dbPath, config, jobId: claimed.job.id, workerId, fencingToken: claimed.fencingToken, revision: claimed.revision, now: Number(now) });
  if (!begun.ok) process.exit(4);
}
process.kill(process.pid, "SIGKILL");
