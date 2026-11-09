import { claimCore, loadConfig } from "../jobs.mjs";

const [dbPath, configPath, workerId, now, accountsJson] = process.argv.slice(2);
const config = loadConfig(configPath, { now: Number(now) });
const result = claimCore({ dbPath, config, workerId, accounts: JSON.parse(accountsJson), now: Number(now) });
process.stdout.write(JSON.stringify(result));
