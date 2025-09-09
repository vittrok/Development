/* matches/netlify-prod/public/apply-sort-patch.js */
(() => {
  try {
    if (!('fetch' in window)) return;

    // Ідемпотентність: не патчити двічі
    if (String(window.fetch).includes('patchedFetch')) return;

    const originalFetch = window.fetch.bind(window);

    async function patchedFetch(input, init = {}) {
      // TODO (за потреби в майбутніх мікрокроках): тут можна додати потрібну логіку
      // Напр., діагностику, або корекцію параметрів запиту.
      return originalFetch(input, init);
    }

    Object.defineProperty(patchedFetch, 'name', { value: 'patchedFetch' });
    window.fetch = patchedFetch;

    console.log('[apply-sort-patch] active');
  } catch (e) {
    console.error('[apply-sort-patch] failed:', e);
  }
})();
