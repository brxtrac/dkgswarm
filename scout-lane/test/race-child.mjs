import { claim } from "../jobs.mjs";

const [dbPath, configPath, workerId, now] = process.argv.slice(2);
const result = claim({
  dbPath,
  configPath,
  workerId,
  workerToken: process.env.TEST_WORKER_TOKEN,
  now: Number(now),
});
process.stdout.write(JSON.stringify(result));
