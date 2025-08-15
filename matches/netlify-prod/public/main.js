let CSRF = null; // will store token from getPreferences

async function j(url, opts) {
  // automatically inject CSRF token into POST requests
  const finalOpts = { ...opts };
  if (finalOpts && finalOpts.method && finalOpts.method.toUpperCase() === 'POST') {
    finalOpts.headers = {
      ...(finalOpts.headers || {}),
      'X-CSRF': CSRF,
      'X-Requested-With': 'fetch',
    };
  }
  const res = await fetch(url, finalOpts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function showStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.style.display = msg ? 'block' : 'none';
  if (!isError) setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function renderMatches(data, seenColor) {
  const tbody = document.querySelector('#matches tbody');
  tbody.innerHTML = '';
  const rows = data.matches || [];
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.dataset.date = row.date;
    tr.dataset.match = row.match;

    // rank (#)
    const c0 = document.createElement('td'); c0.textContent = row.rank ?? ''; tr.appendChild(c0);
    // match
    const c1 = document.createElement('td'); c1.textContent = row.match; tr.appendChild(c1);
    // tournament
    const c2 = document.createElement('td'); c2.textContent = row.tournament || ''; tr.appendChild(c2);
    // date
    const c3 = document.createElement('td'); c3.textContent = row.date; tr.appendChild(c3);
    // link
    const c4 = document.createElement('td');
    if (row.link) {
      const a = document.createElement('a');
      a.href = row.link;
      a.textContent = row.link;
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "link";
      c4.appendChild(a);
    } else { c4.textContent = ''; }
    tr.appendChild(c4);
    // seen
    const c5 = document.createElement('td');
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!row.seen;
    c5.appendChild(chk); tr.appendChild(c5);
    // comments
    const c6 = document.createElement('td');
    const input = document.createElement('input'); input.type = 'text'; input.className = 'comment'; input.value = row.comments || '';
    c6.appendChild(input); tr.appendChild(c6);

    if (row.seen) { tr.classList.add('seen'); tr.style.backgroundColor = seenColor; }

    chk.addEventListener('change', async () => {
      tr.classList.toggle('seen', chk.checked);
      tr.style.backgroundColor = chk.checked ? seenColor : '';
      try {
        await j('/.netlify/functions/updateMatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: row.date, match: row.match, seen: chk.checked })
        });
      } catch (e) { console.error(e); showStatus('Не вдалось оновити "seen"', true); }
    });

    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        try {
          await j('/.netlify/functions/updateMatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: row.date, match: row.match, comments: input.value })
          });
        } catch (e) { console.error(e); showStatus('Не вдалось зберегти коментар', true); }
      }, 400);
    });

    tbody.appendChild(tr);
  });

  // headers arrows
  document.querySelectorAll('th[data-col]').forEach(th => {
    const col = th.dataset.col;
    th.textContent = (col === 'rank') ? '#' : col;
    if (data.sort && data.sort.column === col) {
      th.textContent += (data.sort.order === 'asc' ? ' ▲' : ' ▼');
    }
  });
}

function attachSortHandlers() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    const col = th.dataset.col;
    th.addEventListener('click', async () => {
      const hasAsc = th.textContent.trim().endsWith('▲');
      const newOrder = hasAsc ? 'desc' : 'asc';
      try {
        await j('/.netlify/functions/setSort', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ column: col, order: newOrder })
        });
        await loadAndRender();
      } catch (e) {
        console.error(e);
        showStatus('Не вдалось змінити сортування', true);
      }
    });
  });
}

async function loadPreferencesSafe() {
  try {
    const prefs = await j('/.netlify/functions/getPreferences');
    CSRF = prefs.csrf; // store CSRF from backend
    return prefs;
  } catch (e) {
    console.error('getPreferences error:', e);
    return { seen_color: 'lightyellow', sort: { column: 'date', order: 'asc' } };
  }
}

async function loadAndRender() {
  try {
    showStatus('Завантаження…');
    const prefs = await loadPreferencesSafe();
    const data = await j('/.netlify/functions/getMatches');
    const color = prefs.seen_color || 'lightyellow';
    document.documentElement.style.setProperty('--seen-bg', color);
    const sel = document.getElementById('seenColor');
    if (sel) sel.value = color;
    renderMatches(data, color);
    showStatus('Готово');
  } catch (e) {
    console.error(e);
    showStatus('Помилка завантаження даних', true);
  }
}

document.getElementById('seenColor').addEventListener('change', async (e) => {
  const val = e.target.value;
  document.documentElement.style.setProperty('--seen-bg', val);
  try {
    await j('/.netlify/functions/setPreference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'seen_color', value: val })
    });
    document.querySelectorAll('tr.seen').forEach(tr => tr.style.backgroundColor = val);
    showStatus('Колір збережено');
  } catch (e) {
    console.error(e);
    showStatus('Не вдалось зберегти колір', true);
  }
});

document.getElementById('syncBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncBtn');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Синхронізую...';
  try {
    const res = await j('/.netlify/functions/update-matches');
    showStatus(`Синхронізація: додано ${res.newMatches || 0}, пропущено ${res.skippedMatches || 0}`);
    await loadAndRender();
    if (document.querySelector('.tab-btn.active')?.dataset.tab === 'logs') {
      document.querySelector('.tab-btn[data-tab="logs"]').click();
    }
  } catch (e) {
    console.error(e);
    showStatus('Помилка синхронізації', true);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
});

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-matches').classList.toggle('hidden', tab !== 'matches');
    document.getElementById('tab-logs').classList.toggle('hidden', tab !== 'logs');
    if (tab === 'logs') {
      try {
        const data = await j('/.netlify/functions/getSyncLogs');
        const tbody = document.querySelector('#logs tbody');
        tbody.innerHTML = '';
        for (const r of (data.logs || [])) {
          const tr = document.createElement('tr');
          const dt = new Date(r.sync_time);
          const local = isNaN(dt.getTime()) ? r.sync_time : dt.toLocaleString();
          tr.innerHTML = `<td>${local}</td><td>${r.trigger_type}</td><td>${r.client_ip || ''}</td><td>${r.new_matches}</td><td>${r.skipped_matches}</td>`;
          tbody.appendChild(tr);
        }
      } catch (e) { console.error(e); showStatus('Не вдалось завантажити логи', true); }
    }
  });
});

attachSortHandlers();
loadAndRender();
