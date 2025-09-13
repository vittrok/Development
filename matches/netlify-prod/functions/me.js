// functions/me.js
// GET /me
// Повертає стан автентифікації, csrf-токен (якщо залогінений), базову інформацію користувача
// Архітектура v1.1: CORS тільки через _utils.corsHeaders(), сесії — через _session

const crypto = require("crypto");
const { corsHeaders } = require("./_utils");           // єдине джерело CORS
const { getSession } = require("./_session");          // єдине джерело логіки сесії
// Якщо у вашому _session інший export — дайте знати, підлаштую імпорт/виклик під фактичний API.

const CSRF_SECRET = process.env.CSRF_SECRET || "";
const JSON_HEADERS = {
  ...corsHeaders(),
  "Content-Type": "application/json; charset=utf-8",
};

// HMAC_SHA256(CSRF_SECRET, sid) → hex
function makeCsrf(sid) {
  if (!sid || !CSRF_SECRET) return null;
  try {
    return crypto.createHmac("sha256", CSRF_SECRET).update(String(sid)).digest("hex");
  } catch {
    return null;
  }
}

function json(status, obj, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }
    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "method_not_allowed" });
    }

    // Єдина точка істини щодо сесії
    // Очікуємо, що getSession(event) повертає:
    //   { isAuthenticated: boolean, sid: string|null, userId: number|null, user: { id, username, role }|null }
    // Якщо у вашій реалізації інший інтерфейс — оновлю тут виклик відповідно.
    const sess = await getSession(event);

    const isAuth = !!(sess && sess.isAuthenticated);
    const sid = (sess && sess.sid) || null;
    const csrf = isAuth ? makeCsrf(sid) : null;

    // Мінімальний набір даних користувача (PII мінімум, без секретів)
    const user = isAuth && sess.user
      ? {
          id: sess.user.id ?? null,
          username: sess.user.username ?? null,
          role: sess.user.role ?? null,
        }
      : null;

    // preferences наразі не тягнемо з БД тут — як і раніше повертаємо {}.
    // (Логіка преференсів централізована в /preferences.)
    return json(200, {
      ok: true,
      auth: { isAuthenticated: isAuth, user },
      csrf,
      preferences: {},
    });
  } catch (e) {
    console.error("[me] fatal:", e);
    return json(500, { ok: false, error: "internal" });
  }
};
