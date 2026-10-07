document.addEventListener('DOMContentLoaded', async () => {
  const strip = document.querySelector('[data-swarm-stats]');
  if (!strip) return;
  try {
    const response = await fetch('/api/swarm/stats');
    if (!response.ok) throw new Error('Stats unavailable');
    const stats = await response.json();
    const values = {
      sources: stats.collectedSources,
      shared: stats.sharedPosts,
      active24h: stats.windows?.last24Hours?.connectedInstallations,
      active7d: stats.windows?.last7Days?.connectedInstallations
    };
    const displayed = [];
    for (const [name, value] of Object.entries(values)) {
      const target = strip.querySelector(`[data-stat="${name}"]`);
      if (target) {
        displayed.push(value);
        if (Number.isFinite(value)) target.textContent = value.toLocaleString();
      }
    }
    const note = strip.querySelector('[data-stat-note]');
    if (displayed.some(value => !Number.isFinite(value))) note.textContent = 'Some activity metrics are temporarily unavailable';
    else if (stats.availability?.sharedMemory === 'stale') note.textContent = 'Shared-memory count is from the last successful check';
    else note.remove();
  } catch {
    strip.querySelector('[data-stat-note]').textContent = 'Activity temporarily unavailable';
  }
});
