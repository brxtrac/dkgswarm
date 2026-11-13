import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

// Live defaults are shown; override with the environment on another host.
const directory = process.env.TRAC_DRAFTS_DIR || '/root/trac-marketing-drafts';
// Keep production route until bounded screening fixtures justify the cheaper route.
const model = process.env.TRAC_CURATOR_MODEL || '9router/cx/gpt-6-sol';
const [providerID, ...modelParts] = model.split('/');
const modelID = modelParts.join('/');
if (!providerID || !modelID) throw new Error('TRAC_CURATOR_MODEL must be provider/model');
const curatorScript = process.env.TRAC_CURATOR_SCRIPT || '/root/dkg-swarm-webhooks/curator.mjs';
const agentPolicy = process.env.TRAC_CURATOR_AGENT_POLICY || '/root/.config/opencode/agents/trac-marketing-curator.md';
const agentName = process.env.TRAC_CURATOR_AGENT || 'trac-marketing-curator';
const prompt = 'Review bounded new TRAC marketing WM drafts; check SWM duplicates first, promote only strong evidenced sources; report results.';
const statePath = `${directory}/data/curator-state.json`;
function execute(args, timeout = 15000, maxBuffer = 262144) {
  const result = spawnSync('opencode', args, { cwd: directory, encoding: 'utf8', timeout, maxBuffer });
  if (result.status !== 0) throw new Error('OpenCode scheduled curator failed');
  return result.stdout;
}
mkdirSync(`${directory}/data`, { recursive: true, mode: 0o700 });
const listing = spawnSync(process.execPath, [curatorScript, 'list'], { cwd: directory, encoding: 'utf8', timeout: 60000, maxBuffer: 262144 });
if (listing.status !== 0) throw new Error('Candidate inventory unavailable; no model called');
const inventory = JSON.parse(listing.stdout);
if (inventory.graph !== 'trac-marketing' || !Array.isArray(inventory.candidates) || !Array.isArray(inventory.communityDrafts)) throw new Error('Invalid candidate inventory');
const inputHash = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
const policyHash = createHash('sha256').update(readFileSync(agentPolicy)).update(readFileSync(curatorScript)).update(prompt + model).digest('hex');
let previous;
try { previous = JSON.parse(readFileSync(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
function save(record) {
  writeFileSync(`${statePath}.tmp`, JSON.stringify({ inputHash, policyHash, at: Date.now(), model, ...record }) + '\n', { mode: 0o600 });
  renameSync(`${statePath}.tmp`, statePath);
}
if (!inventory.candidates.length && !inventory.communityDrafts.length) { save({ status: 'empty' }); }
else if (previous?.inputHash === inputHash && previous.policyHash !== policyHash) { console.error('Policy changed; explicit curator-state archival required for reevaluation'); process.exitCode = 1; }
else if (previous?.inputHash === inputHash && (previous.status === 'complete' || previous.status === 'running' || previous.quarantined || previous.nextAttemptAt > Date.now())) { console.log(JSON.stringify({ status: 'unchanged-or-deferred', quarantined: previous.quarantined || previous.status === 'running' })); }
else {
  let sessionID;
  try {
    const session = JSON.parse(execute(['api', 'post', '/api/session', '--data', JSON.stringify({ agent: agentName, location: { directory }, model: { providerID, id: modelID }, metadata: { openchamber: { kind: 'scheduled' }, automation: { job: agentName, owner: 'systemd', policyHash, inputHash } } })])).data;
    if (!session?.id || session.metadata?.openchamber?.kind !== 'scheduled' || session.location?.directory !== directory) throw new Error('Scheduled session ownership not confirmed');
    sessionID = session.id;
    save({ status: 'running', sessionID });
    const output = execute(['run', '--session', sessionID, '--agent', agentName, '--model', model, '--format', 'json', prompt], 660000);
    const events = output.trim().split('\n').map((line) => JSON.parse(line));
    if (events.some((event) => event.type === 'error') || !events.some((event) => event.type === 'text')) throw new Error('Invalid scheduled completion');
    save({ status: 'complete', sessionID });
  } catch {
    const failures = (previous?.inputHash === inputHash ? previous.failures || 0 : 0) + 1;
    save({ status: 'failed', sessionID, failures, quarantined: failures >= 3, nextAttemptAt: Date.now() + Math.min(86400000, 300000 * 2 ** failures) });
    console.error('Scheduled marketing curator failed; inspect private session and project state');
    process.exitCode = 1;
  } finally {
    if (sessionID) {
      try { execute(['api', 'post', `/api/session/${sessionID}/interrupt`, '--data', '{}']); execute(['api', 'patch', `/api/session/${sessionID}`, '--data', '{"archived":true}']); }
      catch { console.error('Scheduled marketing session cleanup failed; inspect project state'); }
    }
  }
}
