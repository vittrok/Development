// File: public/prefs-init.js
// Архітектура v1.1: ініціалізація користувацьких преференсів на старті.
// Підтягує seen_color і застосовує його до "seen"-елементів з єдиного джерела: /.netlify/functions/preferences.

(function () {
  const ORIGIN = 'https://football-m.netlify.app';
  const SEEN_FALLBACK = '#bbf7d0'; // запасний колір

  async function fetchPreferences() {
    try {
      const res = await fetch(`${ORIGIN}/.netlify/functions/preferences`, { credentials: 'include' });
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      if (!json || !json.ok) return null;
      return json.data || null; // { seen_color, sort, filters, ... }
    } catch {
      return null;
    }
  }

  function applySeenColor(hex) {
    const color = (typeof hex === 'string' && hex.trim()) ? hex.trim() : SEEN_FALLBACK;
    // 1) CSS-змінна на :root
    document.documentElement.style.setProperty('--seen-color', color);
    // 2) Якщо у розмітці є елементи з data-seen="1" — підсвітимо
    const seenNodes = document.querySelectorAll('[data-seen="1"], .seen');
    seenNodes.forEach(el => {
      el.style.backgroundColor = color;
    });
  }

  async function init() {
    const prefs = await fetchPreferences();
    applySeenColor(prefs && prefs.seen_color);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
