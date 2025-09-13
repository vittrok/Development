// functions/me.js
// GET /me
// Повертає стан автентифікації, csrf-токен (якщо залогінений), мінімальні дані користувача
// Узгоджено з _session.getSession(event) -> { sid, role } | null

const crypto = require("crypto");
const { corsHeaders } = require("./_utils");    // централізований CORS
const { getSession } = require("./_session");   // повертає { sid, role } або null

const CSRF_SECRET = process.env.CSRF_SECRET || "";

function makeJson(status, obj, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
    body: JSON.stringify(obj),
  };
}

// HMAC_SHA256(CSRF_SECRET, sid) -> hex
function makeCsrf(sid) {
  if (!sid || !CSRF_SECRET) return null;
  try {
    return crypto.createHmac("sha256", CSRF_SECRET).update(String(sid)).digest("hex");
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }
    if (event.httpMethod !== "GET") {
      return makeJson(405, { ok: false, error: "method_not_allowed" });
    }

    // _session.getSession приймає або event, або "sid.sig"
    const sess = await getSession(event); // { sid, role } | null

    const isAuth = !!sess;
    const sid = isAuth ? sess.sid : null;
    const csrf = isAuth ? makeCsrf(sid) : null;

    // Мінімальний user-об’єкт: role відомий з sess; id/username тут не тягнемо
    const user = isAuth ? { role: sess.role || "user" } : null;

    return makeJson(200, {
      ok: true,
      auth: { isAuthenticated: isAuth, user },
      csrf,
      preferences: {}, // як і раніше: /preferences — окремий ендпоїнт
    });
  } catch (e) {
    console.error("[me] fatal:", e);
    return makeJson(500, { ok: false, error: "internal" });
  }
};
