const HEALTH_COPY = {
  green: { home: 'Context 01 live', live: 'Available now', directory: 'LIVE NOW' },
  yellow: { home: 'Context 01 delayed: catching up', live: 'Catching up', directory: 'CATCHING UP' },
  red: { home: 'Context 01 disrupted', live: 'Disrupted', directory: 'DISRUPTED' }
};

function paintHealth(level) {
  const copy = HEALTH_COPY[level] || HEALTH_COPY.red;
  document.querySelectorAll('[data-swarm-health]').forEach((node) => {
    const dot = node.querySelector('.status-dot');
    const label = node.querySelector('[data-health-label]');
    if (dot) dot.dataset.level = level in HEALTH_COPY ? level : 'red';
    node.dataset.level = level in HEALTH_COPY ? level : 'red';
    if (label) label.textContent = copy[node.dataset.swarmHealth] || copy.home;
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const health = await fetch('/api/swarm/health');
    const body = await health.json();
    paintHealth(body.level);
  } catch {
    paintHealth('red');
  }

  const strip = document.querySelector('[data-swarm-stats]');
  if (!strip) return;
  try {
    const response = await fetch('/api/swarm/stats');
    if (!response.ok) throw new Error('Stats unavailable');
    const stats = await response.json();
    const values = {
      sources: stats.collectedSources,
      shared: stats.sharedPosts,
      agents: stats.connectedAgents,
      drafts: stats.sharedDrafts
    };
    for (const [name, value] of Object.entries(values)) {
      const target = strip.querySelector(`[data-stat="${name}"]`);
      if (target && Number.isFinite(value)) target.textContent = value.toLocaleString();
    }
    strip.querySelector('[data-stat-note]').remove();
  } catch {
    strip.querySelector('[data-stat-note]').textContent = 'Activity temporarily unavailable';
  }
});
