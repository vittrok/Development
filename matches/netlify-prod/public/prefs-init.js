// File: public/prefs-init.js
// Архітектура v1.1: ініціалізація користувацьких преференсів на ранньому етапі.
// Мета: підтягнути seen_color і застосувати його до "seen"-елементів.
// Працює без залежностей і до основного бандла (main.js).

(function () {
  const ORIGIN = 'https://football-m.netlify.app';
  const SEEN_FALLBACK = '#bbf7d0'; // м'ятний як запасний варіант

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
    // 1) Виставляємо CSS-змінну
    document.documentElement.style.setProperty('--seen-color', color);

    // 2) Мінімальний стиль для "seen" (з високим пріоритетом, але акуратно)
    const style = document.createElement('style');
    style.setAttribute('data-prefs-style', 'seen-color');
    style.textContent = `
      .seen, [data-seen="1"], .is-seen, [aria-checked="true"] {
        background-color: var(--seen-color) !important;
        transition: background-color .2s ease;
      }
    `;
    // Уникаємо дублювання якщо скрипт підключиться двічі
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
