(() => {
  const nodes = document.querySelector('#nodes');
  const graph = document.querySelector('#graph');
  const links = document.querySelector('#links');
  const entries = document.querySelector('#entries');
  const status = document.querySelector('#feed-status');
  const search = document.querySelector('#search');
  const loadMore = document.querySelector('#load-more');
  const dialog = document.querySelector('#detail');
  let memories = [];
  let nextOffset = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function open(entry) {
    document.querySelector('#detail-title').textContent = entry.title;
    document.querySelector('#detail-id').textContent = entry.id;
    document.querySelector('#detail-text').textContent = entry.text;
    const source = document.querySelector('#detail-source');
    source.hidden = !entry.source;
    if (entry.source) source.href = entry.source;
    dialog.showModal();
  }
  document.querySelector('#close-detail').addEventListener('click', () => dialog.close());
  document.querySelector('#close-detail-bottom').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

  function renderList() {
    const needle = search.value.trim().toLowerCase();
    const selected = memories.filter(item => (item.title + ' ' + item.text).toLowerCase().includes(needle));
    entries.replaceChildren();
    if (!selected.length) {
      const message = document.createElement('p');
      message.textContent = memories.length ? 'No shared memories match. Try another term.' : 'No shared memories available yet.';
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
  search.addEventListener('input', renderList);

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
  async function fetchPage() {
    const offset = nextOffset;
    loadMore.disabled = true;
    try {
      const response = await fetch(`/api/swarm/memory?offset=${offset}`);
      if (!response.ok) throw new Error('Graph unavailable');
      const data = await response.json();
      memories.push(...(Array.isArray(data.entries) ? data.entries : []));
      nextOffset = data.nextOffset;
      loadMore.hidden = nextOffset === null;
      status.textContent = `${memories.length} shared entries loaded${nextOffset === null ? '' : ' · more available'}`;
      status.classList.add('ready');
      renderGraph(); renderList();
    } catch {
      status.textContent = 'Graph temporarily unavailable';
      if (!memories.length) entries.textContent = 'Shared memory could not load. Refresh to try again.';
      else loadMore.textContent = 'Retry loading more';
    } finally {
      loadMore.disabled = false;
    }
  }
  loadMore.addEventListener('click', fetchPage);
  fetchPage();
  if (reduced) graph.classList.add('still');
})();
