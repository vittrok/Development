/**
 * apply-sort-patch.js
 * Накладний перехоплювач window.fetch для /.netlify/functions/setSort:
 * - конвертує тіло { column, order } -> { col, order }
 * - додає заголовок X-CSRF із /.netlify/functions/me (credentials: 'include')
 * Без змін основного бандла. В межах архітектури v1.1.
 */
(function () {
  const ORIGIN = location.origin;
  const TARGET = "/.netlify/functions/setSort";

  const originalFetch = window.fetch.bind(window);

  async function getCsrf() {
    const res = await originalFetch(`${ORIGIN}/.netlify/functions/me`, { credentials: 'include' });
    if (!res.ok) throw new Error(`GET /me failed: ${res.status}`);
    const json = await res.json();
    return json && json.csrf ? json.csrf : '';
  }

  window.fetch = async function patchedFetch(input, init = {}) {
    try {
      const url = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
      if (url && url.includes(TARGET)) {
        const headers = new Headers(init.headers || {});
        // Додати X-CSRF, якщо немає
        if (!headers.has('X-CSRF')) {
          try {
            const csrf = await getCsrf();
            if (csrf) headers.set('X-CSRF', csrf);
          } catch (e) {
            console.warn('[apply-sort-patch] CSRF fetch failed:', e);
          }
        }

        // Перетворити body: column -> col
        let body = init.body;
        if (typeof body === 'string') {
          try {
            const obj = JSON.parse(body);
            if ('column' in obj && !('col' in obj)) {
              obj.col = obj.column;
              delete obj.column;
            }
            body = JSON.stringify(obj);
          } catch (e) {
            console.warn('[apply-sort-patch] JSON body parse failed:', e);
          }
        }

        const patchedInit = Object.assign({}, init, {
          headers,
          body,
          credentials: 'include'  // як у фронті для same-origin cookies
        });

        const resp = await originalFetch(input, patchedInit);
        return resp;
      }
    } catch (e) {
      console.warn('[apply-sort-patch] error:', e);
    }
    return originalFetch(input, init);
  };

  console.log('[apply-sort-patch] active');
})();
