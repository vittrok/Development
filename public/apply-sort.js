// File: public/apply-sort.js
// Накладний скрипт: читає preferences з єдиного ендпойнта /.netlify/functions/preferences
// і пересортовує #matches tbody. Без секретів. Працює після того, як основний бандл відмалював таблицю.

(function () {
  const ORIGIN = 'https://football-m.netlify.app'; // прод-домен
  const TABLE_SELECTOR = '#matches tbody';

  // Відповідність backend-ключів до data-col у <th>
  const COL_MAP = {
    kickoff_at: ['kickoff_at', 'date', 'kickoff'],
    tournament: ['tournament'],
    status: ['status'],
    rank: ['rank'],
    home_team: ['home_team', 'home', 'match'],
    away_team: ['away_team', 'away', 'match'],
  };

  function log(msg, isError = false) {
    const el = document.getElementById('status');
    if (el) {
      el.textContent = String(msg);
      el.classList.toggle('error', !!isError);
    } else {
      console[isError ? 'error' : 'log']('[apply-sort]', msg);
    }
  }

  async function fetchPreferences() {
    const url = `${ORIGIN}/.netlify/functions/preferences`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`prefs ${res.status}`);
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) throw new Error('bad prefs JSON');
    return json.data || {};
  }

  function findColIndexByKeys(thead, keys) {
    const ths = thead.querySelectorAll('th');
    for (let i = 0; i < ths.length; i++) {
      const dc = String(ths[i].dataset.col || '').toLowerCase().trim();
      if (!dc) continue;
      for (const k of keys) {
        if (dc === k) return i;
      }
    }
    return -1;
  }

  function sortRows(tbody, colIndex, dir) {
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const factor = (dir === 'desc') ? -1 : 1;

    rows.sort((a, b) => {
      const aCell = a.children[colIndex]?.textContent?.trim() ?? '';
      const bCell = b.children[colIndex]?.textContent?.trim() ?? '';
      if (aCell === bCell) return 0;
      return aCell > bCell ? factor : -factor;
    });

    rows.forEach(r => tbody.appendChild(r));
  }

  async function init() {
    try {
      const prefs = await fetchPreferences(); // { sort, sort_col, sort_order, ... }
      const sortKey = prefs.sort_col || 'kickoff_at';
      const sortOrder = (prefs.sort_order === 'asc' || prefs.sort_order === 'desc') ? prefs.sort_order : 'desc';

      const table = document.querySelector(TABLE_SELECTOR)?.closest('table');
      if (!table) return log('таблицю не знайдено');
      const thead = table.querySelector('thead');
      const tbody = table.querySelector('tbody');
      if (!thead || !tbody) return log('thead/tbody відсутні');

      const colKeys = COL_MAP[sortKey] || [sortKey];
      const colIndex = findColIndexByKeys(thead, colKeys);
      if (colIndex < 0) return log(`колонку для ${sortKey} не знайдено`);

      sortRows(tbody, colIndex, sortOrder);
      log(`відсортовано за ${sortKey} (${sortOrder})`);
    } catch (e) {
      log(`помилка сортування: ${e.message || e}`, true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
