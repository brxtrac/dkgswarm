document.addEventListener('DOMContentLoaded', async () => {
  const strip = document.querySelector('[data-swarm-stats]');
  if (!strip) return;
  try {
    const response = await fetch('/api/swarm/stats');
    if (!response.ok) throw new Error('Stats unavailable');
    const stats = await response.json();
    const values = {
      sources: stats.collectedSources,
      shared: stats.sharedPosts
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
