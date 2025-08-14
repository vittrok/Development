const COLOR_OPTIONS = [
  "lightyellow","lightgreen","lightblue","lightpink",
  "lightgray","lightcyan","lightcoral","lightgoldenrodyellow",
  "lavender","honeydew","mintcream","aliceblue",
  "mistyrose","seashell","beige","whitesmoke"
];

function colorOptionsHTML(selected) {
  return COLOR_OPTIONS.map(c => `<option value="\${c}" \${selected===c?'selected':''}>\${c}</option>`).join('');
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function renderTable(data) {
  const tbody = document.getElementById('matches-body');
  tbody.innerHTML = '';
  const rows = data.matches;
  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.dataset.date = row.date;
    tr.dataset.match = row.match;

    // index
    const c0 = document.createElement('td');
    c0.textContent = i + 1;
    tr.appendChild(c0);

    // match
    const c1 = document.createElement('td');
    c1.textContent = row.match;
    tr.appendChild(c1);

    // tournament
    const c2 = document.createElement('td');
    c2.textContent = row.tournament;
    tr.appendChild(c2);

    // date
    const c3 = document.createElement('td');
    c3.textContent = row.date;
    tr.appendChild(c3);

    // link
    const c4 = document.createElement('td');
    const a = document.createElement('a');
    a.href = row.link;
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "link";
    a.textContent = "open";
    c4.appendChild(a);
    tr.appendChild(c4);

    // color
    const c5 = document.createElement('td');
    const sel = document.createElement('select');
    sel.innerHTML = colorOptionsHTML(row.color || 'lightyellow');
    if (!row.seen) sel.disabled = true;
    c5.appendChild(sel);
    tr.appendChild(c5);

    // seen
    const c6 = document.createElement('td');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!row.seen;
    c6.appendChild(chk);
    tr.appendChild(c6);

    // apply bg
    if (row.seen) tr.style.backgroundColor = row.color || 'lightyellow';

    chk.addEventListener('change', async () => {
      const seen = chk.checked;
      sel.disabled = !seen;
      tr.style.backgroundColor = seen ? (sel.value || 'lightyellow') : '';
      try {
        await fetchJSON('/api/updateMatch', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ date: row.date, match: row.match, seen, color: sel.value })
        });
      } catch(e) { console.error(e); }
    });

    sel.addEventListener('change', async () => {
      if (chk.checked) tr.style.backgroundColor = sel.value;
      try {
        await fetchJSON('/api/updateMatch', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ date: row.date, match: row.match, seen: chk.checked, color: sel.value })
        });
      } catch(e) { console.error(e); }
    });

    tbody.appendChild(tr);
  });

  // update headers with sort arrows
  document.querySelectorAll('th[data-col]').forEach(th => {
    const col = th.dataset.col;
    if (col === '#') { th.textContent = '#'; return; }
    th.textContent = col;
    if (data.sort && data.sort.column === col) {
      th.textContent = col + (data.sort.order === 'asc' ? ' ▲' : ' ▼');
    }
  });
}

async function load() {
  try {
    const data = await fetchJSON('/api/getMatches');
    renderTable(data);
  } catch (e) {
    console.error(e);
  }
}

document.querySelectorAll('th[data-col]').forEach(th => {
  const col = th.dataset.col;
  if (col === '#') return;
  th.addEventListener('click', async () => {
    // toggle desired order based on current arrow
    const hasAsc = th.textContent.endsWith('▲');
    const hasDesc = th.textContent.endsWith('▼');
    const newOrder = hasAsc ? 'desc' : 'asc';
    try {
      await fetchJSON('/api/setSort', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ column: col, order: newOrder })
      });
      await load();
    } catch(e) { console.error(e); }
  });
});

load();
