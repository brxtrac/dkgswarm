import { buildRun, initialState, inspect, decide, advance, rest } from './game-rules.js';

const $ = (id) => document.getElementById(id);
const bestKey = 'dkgswarm-evidence-run-best-v1';
const packKey = 'dkgswarm-evidence-pack-v1';
let pack, run, state, seed;
const best = () => { try { return Math.max(0, Number(localStorage.getItem(bestKey)) || 0); } catch { return 0; } };
function show(id) { for (const name of ['start-screen', 'question-screen', 'result-screen']) $(name).hidden = id !== name; }
function stats() {
  $('score').textContent = String(state?.score || 0);
  $('best').textContent = String(best());
  $('energy').textContent = String(state?.energy ?? 70);
  $('trust').textContent = String(state?.trust ?? 70);
  $('discernment').textContent = String(state?.discernment ?? 3);
  $('round-indicator').textContent = `${Math.min((state?.day || 0) + 1, 8)} / 8 DAYS`;
  $('progress-fill').style.width = `${(state?.day || 0) * 12.5}%`;
}
function evidence(entry) {
  $('evidence-title').textContent = entry.title;
  $('evidence-text').textContent = entry.excerpt;
  $('evidence-meta').textContent = `Asset: ${entry.id} · Graph: trac-marketing · Layer: shared memory · Observed: ${entry.observed || 'unknown'} · Source tier: ${entry.tier || 'unknown'} · Claim status: ${entry.status || 'unknown'}`;
  $('record-link').href = '/memory';
  const source = $('source-link');
  source.hidden = !entry.source || !/^https:\/\//.test(entry.source);
  if (!source.hidden) source.href = entry.source;
  const target = $('target-link');
  target.hidden = !entry.target || !/^https:\/\//.test(entry.target);
  if (!target.hidden) target.href = entry.target;
}
function render() {
  const mission = run[state.day];
  $('signal-type').textContent = `DAY ${state.day + 1} · ${mission.title.toUpperCase()}`;
  $('scenario').textContent = mission.question;
  $('context').textContent = `Convoy must decide how to handle a shared-memory record. Inspecting costs 7 Energy and improves a correct decision's score. Pack ${pack.hash.slice(0, 10)} · ${pack.asOf.slice(0, 10)}.`;
  $('evidence').hidden = !state.inspected && !state.resolved;
  evidence(mission.entry);
  $('inspect').disabled = state.resolved || state.inspected || state.energy < 7;
  $('rest').disabled = state.resolved || state.inspected || state.rested || state.discernment < 1 || state.energy >= 90;
  const choices = $('options'); choices.replaceChildren();
  mission.choices.forEach((text, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'option'; button.textContent = text;
    button.disabled = state.resolved;
    button.addEventListener('click', () => {
      state = decide(state, mission, index);
      $('feedback').replaceChildren();
      const heading = document.createElement('strong');
      heading.textContent = index === mission.answer ? 'Evidence handled well.' : 'Trust lost. Review evidence boundary.';
      const detail = document.createElement('span'); detail.textContent = mission.reason;
      $('feedback').append(heading, detail); $('feedback').hidden = false;
      $('evidence').hidden = false;
      $('next').hidden = false;
      render(); $('next').focus();
    });
    choices.append(button);
  });
  show('question-screen'); stats();
}
function finish() {
  const survived = state.trust > 0 && state.energy > 0;
  const previous = best();
  if (state.score > previous) { try { localStorage.setItem(bestKey, String(state.score)); } catch {} }
  $('result-title').textContent = survived ? 'Convoy reached next datatown.' : 'Convoy needs a stronger evidence trail.';
  $('result-detail').textContent = `Handled ${state.log.length} real graph records. ${state.log.filter((item) => item.correct).length} decisions followed evidence rules. Claims remain attributed, not certified true. Pack ${pack.hash.slice(0, 14)}.`;
  $('final-score').textContent = String(state.score);
  $('personal-best').textContent = `Local best: ${Math.max(previous, state.score)}. New season; classic scores untouched.`;
  show('result-screen'); stats(); $('replay').focus();
}
function start() {
  seed = `${Date.now()}:${Math.random()}`;
  run = buildRun(pack, seed); state = initialState();
  $('feedback').hidden = true; $('next').hidden = true; render();
}
async function validPack(candidate) {
  if (!candidate || !/^[a-f0-9]{64}$/.test(candidate.hash || '')) throw new Error('Invalid pack hash');
  const { hash, ...snapshot } = candidate;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot)));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== expected) throw new Error('Modified pack');
  const age = Date.now() - Date.parse(candidate.asOf);
  if (!Number.isFinite(age) || age < -60000 || age > 7 * 86400000) throw new Error('Expired evidence snapshot');
  buildRun(candidate, 'validate');
  return candidate;
}
async function load() {
  try {
    const response = await fetch('/api/swarm/memory?format=game-pack', { signal: AbortSignal.timeout(40000) });
    if (!response.ok) throw new Error('Evidence endpoint unavailable');
    pack = await validPack(await response.json());
    try { localStorage.setItem(packKey, JSON.stringify(pack)); } catch {}
    $('live-status').textContent = `${pack.entries.length} eligible shared-memory records · snapshot ${pack.asOf.slice(0, 10)} · ${pack.hash.slice(0, 12)}. Snapshot may be stale during graph outages; recheck sources. Evidence is not verified truth.`;
  } catch {
    try {
      const cached = JSON.parse(localStorage.getItem(packKey));
      if (Date.now() - Date.parse(cached.asOf) > 7 * 86400000 || Date.parse(cached.asOf) > Date.now()) throw new Error('Expired snapshot');
      pack = await validPack(cached);
      $('live-status').textContent = `Offline snapshot ${pack.asOf.slice(0, 10)} · ${pack.entries.length} records. Recheck original sources; snapshot may be stale.`;
    } catch {
      $('live-status').textContent = 'Shared evidence unavailable. Expedition paused; no invented graph records substituted. Retry when service returns.';
      $('start').textContent = 'Evidence unavailable';
    }
  }
  if (pack) { $('start').disabled = false; $('start').textContent = 'Begin expedition ↗'; }
}
$('start').addEventListener('click', () => start());
$('replay').addEventListener('click', () => start());
$('inspect').addEventListener('click', () => { state = inspect(state); render(); $('evidence').focus(); });
$('rest').addEventListener('click', () => { state = rest(state); render(); });
$('next').addEventListener('click', () => { state = advance(state); if (state.day >= run.length || state.trust <= 0 || state.energy <= 0) finish(); else { $('feedback').hidden = true; $('next').hidden = true; render(); $('scenario').focus(); } });
$('start').disabled = true;
stats(); load();
