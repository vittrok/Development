// File: public/prefs-init.js
// Архітектура v1.1: ініціалізація користувацьких преференсів на старті.
// Підтягує seen_color і застосовує його до "seen"-елементів.

(function () {
  const ORIGIN = 'https://football-m.netlify.app';
  const SEEN_FALLBACK = '#bbf7d0'; // запасний колір

  async function fetchPreferences() {
    try {
      const res = await fetch(`${ORIGIN}/.netlify/functions/getPreferences`, { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data && data.preferences ? data.preferences : null;
    } catch {
      return null;
    }
  }

  function applySeenColor(hex) {
    const color = (typeof hex === 'string' && hex.trim()) ? hex.trim() : SEEN_FALLBACK;
    // 1) CSS-змінна на :root
    document.documentElement.style.setProperty('--seen-color', color);

    // 2) Мінімальний стиль для "seen"
    const style = document.createElement('style');
    style.setAttribute('data-prefs-style', 'seen-color');
    style.textContent = `
      .seen, [data-seen="1"], .is-seen, [aria-checked="true"] {
        background-color: var(--seen-color) !important;
        transition: background-color .2s ease;
      }
    `;
    const existing = document.head.querySelector('style[data-prefs-style="seen-color"]');
    if (existing) existing.remove();
    document.head.appendChild(style);
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
