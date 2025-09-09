// apply-sort.js
// Накладний скрипт: читає preferences з /me і пересортовує #matches tbody
// Не містить жодних секретів. Працює після того, як основний бандл відмалював таблицю.

(function () {
  const ORIGIN = 'https://football-m.netlify.app'; // прод-домен
  const TABLE_SELECTOR = '#matches tbody';

  // Відповідність backend-ключів до data-col у <th>
  // Якщо у вашому thead data-col інші — додайте сюди.
  const COL_MAP = {
    kickoff_at: ['kickoff_at', 'date', 'kickoff'], // пробуємо по черзі
    tournament: ['tournament'],
    status: ['status'],
    rank: ['rank'],
    home_team: ['home_team', 'home', 'match'], // якщо є окрема колонка home_team — використаємо її; інакше 'match'
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

  async function getPreferences() {
    const url = `${ORIGIN}/.netlify/functions/me`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`GET /me failed: ${res.status}`);
    const json = await res.json();
    return json && json.preferences ? json.preferences : {};
  }

  function getHeaderMap() {
    const map = new Map(); // key -> index
    const ths = document.querySelectorAll('th[data-col]');
    let idx = 0;
    ths.forEach(th => {
      const key = (th.dataset.col || '').trim();
      if (key) map.set(key, idx);
      idx++;
    });
    return map;
  }

  function resolveColIndex(targetKey, headerMap) {
    const candidates = COL_MAP[targetKey] || [targetKey];
    for (const key of candidates) {
      if (headerMap.has(key)) return headerMap.get(key);
    }
    return -1;
  }

  function textOfCell(tr, index) {
    const td = tr.cells[index];
    if (!td) return '';
    // Якщо у TD є data-sort-value — беремо її (OUT OF ARCHITECTURE — див. нижче)
    const v = td.getAttribute('data-sort-value');
    return (v != null) ? v : (td.textContent || '').trim();
  }

  function parseDateLoose(s) {
    // Підтримка ISO/локальних форматів; якщо NaN — повертаємо null
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }

  function makeComparator(index, colKey, order) {
    const asc = (order || 'asc').toLowerCase() === 'asc';
    const mul = asc ? 1 : -1;

    if (colKey === 'kickoff_at') {
      return (a, b) => {
        const ta = parseDateLoose(textOfCell(a, index));
        const tb = parseDateLoose(textOfCell(b, index));
        if (ta == null && tb == null) return 0;
        if (ta == null) return 1; // пусте в кінець
        if (tb == null) return -1;
        return (ta - tb) * (mul * -1); // більша дата вище для desc
      };
    }

    // Стрічкове порівняння (укр/пол/англ локалі)
    return (a, b) => {
      const sa = textOfCell(a, index).toLowerCase();
      const sb = textOfCell(b, index).toLowerCase();
      const cmp = sa.localeCompare(sb, ['uk', 'pl', 'en'], { numeric: true, sensitivity: 'base' });
      return cmp * mul;
    };
  }

  function applySortToTable(colKey, order) {
    const tbody = document.querySelector(TABLE_SELECTOR);
    if (!tbody) {
      log(`Не знайдено ${TABLE_SELECTOR}`, true);
      return false;
    }
    const headerMap = getHeaderMap();
    const index = resolveColIndex(colKey, headerMap);
    if (index < 0) {
      log(`Колонка для '${colKey}' не знайдена у thead[data-col]`, true);
      return false;
    }

    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (!rows.length) {
      log('Немає рядків для сортування');
      return false;
    }

    const comparator = makeComparator(index, colKey, order);
    rows.sort(comparator);

    // Перевставляємо у DOM в новому порядку
    const frag = document.createDocumentFragment();
    for (const r of rows) frag.appendChild(r);
    tbody.innerHTML = '';
    tbody.appendChild(frag);

    log(`Застосовано сортування: ${colKey} ${order}`);
    return true;
  }

  async function run() {
    try {
      // Чекаємо, поки бандл намалює таблицю
      if (document.readyState === 'loading') {
        await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
      }
      // Пауза 0 кадрів, щоб renderMatches встиг відпрацювати
      await new Promise(r => setTimeout(r, 0));

      const prefs = await getPreferences();
      const col = (prefs.sort_col || '').trim();
      const ord = (prefs.sort_order || 'asc').trim().toLowerCase();

      if (!col) {
        log('preferences.sort_col порожній — пропускаємо');
        return;
      }
      applySortToTable(col, ord);
    } catch (e) {
      log(e.message || String(e), true);
    }
  }

  run();
})();
