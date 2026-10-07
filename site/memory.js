(() => {
  const nodes = document.querySelector('#nodes');
  const graph = document.querySelector('#graph');
  const links = document.querySelector('#links');
  const entries = document.querySelector('#entries');
  const status = document.querySelector('#feed-status');
  const search = document.querySelector('#search');
  const form = document.querySelector('#memory-filters');
  const sourceFilter = document.querySelector('#source-filter');
  const fromFilter = document.querySelector('#from-filter');
  const toFilter = document.querySelector('#to-filter');
  const loadMore = document.querySelector('#load-more');
  const dialog = document.querySelector('#detail');
  let memories = [];
  let nextOffset = 0;
  let activeFilters = new URLSearchParams();
  let request;
  let generation = 0;
  let debounce;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function open(entry) {
    document.querySelector('#detail-title').textContent = entry.title;
    document.querySelector('#detail-id').textContent = entry.id;
    document.querySelector('#detail-text').textContent = entry.text;
    const date = document.querySelector('#detail-date');
    date.hidden = !entry.createdAt;
    date.textContent = entry.createdAt ? `Recorded date: ${entry.createdAt}` : '';
    const source = document.querySelector('#detail-source');
    source.hidden = !entry.source;
    if (entry.source) source.href = entry.source;
    dialog.showModal();
  }
  document.querySelector('#close-detail').addEventListener('click', () => dialog.close());
  document.querySelector('#close-detail-bottom').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

  function renderList() {
    const selected = memories;
    entries.replaceChildren();
    if (!selected.length) {
      const message = document.createElement('p');
      message.textContent = activeFilters.size ? 'No shared memories match these filters. Clear or change filters.' : 'No shared memories available yet.';
      entries.append(message);
      return;
    }
    selected.forEach((item, index) => {
      const button = document.createElement('button');
      button.className = 'entry';
      const number = document.createElement('span'); number.className = 'entry-number'; number.textContent = String(index + 1).padStart(2, '0');
      const copy = document.createElement('span'); copy.className = 'entry-copy';
      const title = document.createElement('strong'); title.textContent = item.title;
      const excerpt = document.createElement('span'); excerpt.textContent = item.text.slice(0, 170) + (item.text.length > 170 ? '…' : '');
      copy.append(title, excerpt);
      const arrow = document.createElement('span'); arrow.className = 'entry-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
      button.append(number, copy, arrow);
      button.addEventListener('click', () => open(item));
      entries.append(button);
    });
  }
  function applyFilters() {
    clearTimeout(debounce);
    activeFilters = new URLSearchParams();
    for (const [name, input] of [['q', search], ['source', sourceFilter], ['from', fromFilter], ['to', toFilter]]) {
      if (input.value.trim()) activeFilters.set(name, input.value.trim());
    }
    fetchPage(true);
  }
  form.addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
  form.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(applyFilters, 300);
  });
  document.querySelector('#clear-filters').addEventListener('click', () => { form.reset(); applyFilters(); });

  function renderGraph() {
    nodes.replaceChildren(); links.replaceChildren();
    const featured = memories.slice(0, 9);
    if (!featured.length) return;
    const positions = featured.map((_, i) => {
      const angle = (i / featured.length) * Math.PI * 2 - Math.PI / 2;
      const radius = i % 2 ? 37 : 40;
      return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
    });
    links.setAttribute('viewBox', '0 0 100 100');
    positions.forEach(({ x, y }, i) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '50'); line.setAttribute('y1', '50'); line.setAttribute('x2', x); line.setAttribute('y2', y);
      line.setAttribute('class', 'graph-line'); links.append(line);
      const button = document.createElement('button'); button.className = 'memory-node';
      button.style.left = `${x}%`; button.style.top = `${y}%`; button.style.setProperty('--delay', `${i * -0.57}s`);
      button.setAttribute('aria-label', `Read ${featured[i].title}`);
      const dot = document.createElement('span'); dot.className = 'memory-node-dot';
      const label = document.createElement('span'); label.className = 'memory-node-label'; label.textContent = featured[i].title;
      button.append(dot, label); button.addEventListener('click', () => open(featured[i])); nodes.append(button);
    });
  }
  async function fetchPage(reset = false) {
    request?.abort();
    request = new AbortController();
    const signal = request.signal;
    const current = ++generation;
    if (reset) {
      memories = [];
      nextOffset = 0;
      loadMore.hidden = true;
      entries.textContent = 'Searching shared memory…';
      renderGraph();
    }
    const offset = nextOffset;
    const query = new URLSearchParams(activeFilters);
    query.set('offset', offset);
    loadMore.disabled = true;
    status.classList.remove('ready');
    try {
      const response = await fetch(`/api/swarm/memory?${query}`, { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Shared memory temporarily unavailable');
      if (current !== generation) return;
      if (!Array.isArray(data.entries) || !(data.nextOffset === null || Number.isSafeInteger(data.nextOffset))) throw new Error('Shared memory response unavailable');
      const known = new Set(memories.map(entry => entry.id));
      memories.push(...data.entries.filter(entry => !known.has(entry.id)));
      nextOffset = data.nextOffset;
      loadMore.hidden = nextOffset === null;
      loadMore.textContent = 'Load more shared entries';
      status.textContent = `${memories.length} shared entries loaded${nextOffset === null ? '' : ' · more available'}`;
      status.classList.add('ready');
      renderGraph(); renderList();
    } catch (error) {
      if (signal.aborted || current !== generation) return;
      status.textContent = 'Shared memory could not load';
      if (!memories.length) entries.textContent = error.message;
      loadMore.hidden = false;
      loadMore.textContent = memories.length ? 'Retry loading more' : 'Retry search';
    } finally {
      if (current === generation) loadMore.disabled = false;
    }
  }
  loadMore.addEventListener('click', () => fetchPage());
  fetchPage();
  if (reduced) graph.classList.add('still');
})();
