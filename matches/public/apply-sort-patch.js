// File: public/apply-sort-patch.js
// Тимчасовий адаптер: перехоплює звернення до /.netlify/functions/setSort
// і перенаправляє їх на /.netlify/functions/preferences (уніфікований ендпойнт).
// Залишаємо ДО того, як відрефакторимо main.js на прямий POST /preferences.

(function () {
  const ORIGIN = 'https://football-m.netlify.app';
  const OLD_PATH = '/.netlify/functions/setSort';
  const NEW_PATH = '/.netlify/functions/preferences';

  // Отримати CSRF токен через /me (кука сесії повинна бути)
  async function getCsrf() {
    try {
      const r = await fetch(`${ORIGIN}/.netlify/functions/me`, { credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      return j && j.csrf ? j.csrf : null;
    } catch {
      return null;
    }
  }

  const origFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    try {
      let url = (typeof input === 'string') ? input : (input && input.url) || '';
      // Нормалізуємо до абсолютного виду, якщо відносний
      if (url.startsWith(OLD_PATH) || url.includes(OLD_PATH)) {
        // Парсимо payload зі старого формату
        let body = {};
        try {
          const raw = init && init.body ? init.body : null;
          if (typeof raw === 'string' && raw.trim().startsWith('{')) {
            body = JSON.parse(raw);
          }
        } catch { /* no-op */ }

        // Сумісність: очікуємо, що старий код міг передавати { col, dir } або { sort_col, sort_order }
        const sort_col   = body.sort_col || body.col || 'kickoff_at';
        const sort_order = (body.sort_order || body.dir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

        // Готуємо нове тіло
        const newBody = JSON.stringify({ sort_col, sort_order });

        // Дістаємо CSRF (якщо бек вимагає для POST)
        const csrf = await getCsrf();

        const newInit = {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF': csrf } : {})
          },
          body: newBody
        };

        // Шлемо на уніфікований ендпойнт
        return origFetch(`${ORIGIN}${NEW_PATH}`, newInit);
      }
    } catch (e) {
      console.error('[apply-sort-patch] error:', e);
    }
    return origFetch.apply(this, arguments);
  };

  console.log('[apply-sort-patch] active: legacy setSort → /preferences');
})();
