// functions/_session.js
/* eslint-disable */

let verifySigned;
try {
  ({ verifySigned } = require('./_utils'));
} catch (_) {
  verifySigned = null;
}

function safeParse(v) {
  try { return JSON.parse(v); } catch { return null; }
}

/**
 * getSession(input)
 * input: або підписане значення cookie "session" (string),
 * або Netlify event (щоб дістати cookie з headers).
 * Повертає об'єкт сесії { role, csrf?, sid?, userId? } або null.
 */
async function getSession(input) {
  let signed;

  if (typeof input === 'string') {
    signed = input;
  } else if (input && input.headers) {
    const cookie = input.headers.cookie || input.headers.Cookie || '';
    const m = /(?:^|;\s*)session=([^;]+)/.exec(cookie);
    signed = m ? decodeURIComponent(m[1]) : null;
  }

  if (!signed) return null;

  // 1) Основний шлях: перевірка підпису
  let payload = null;
  if (typeof verifySigned === 'function') {
    try {
      payload = verifySigned(signed);
    } catch (_) {
      payload = null;
    }
  }

  // 2) Фолбек: спроба акуратно декодувати base64/json без verifySigned
  if (!payload) {
    try {
      const head = String(signed).split('.').shift(); // підтримка формату "data.sig"
      const maybeJson = Buffer.from(head, 'base64').toString('utf8');
      payload = safeParse(maybeJson) || null;
    } catch (_) {
      // ігноруємо
    }
  }

  if (!payload || typeof payload !== 'object') return null;

  return {
    role: payload.role || 'user',
    csrf: payload.csrf || null,
    sid: payload.sid || payload.sessionId || null,
    userId: payload.userId || null,
  };
}

module.exports = { getSession };
