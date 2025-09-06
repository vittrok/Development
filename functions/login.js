// functions/login.js
/* eslint-disable */
const crypto = require('crypto');
const { corsHeaders, getPool } = require('./_utils');
const { createSession } = require('./_session');

const pool = getPool();

/* -------------------- robust body parsing -------------------- */
function tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function fromUrlEncoded(raw) {
  const params = new URLSearchParams(String(raw).replace(/^\?/, ''));
  const obj = {};
  for (const [k, v] of params) obj[k] = v;
  return obj;
}
function getJsonBody(event) {
  if (!event) return null;
  let raw = event.body;

  // Netlify інколи ставить isBase64Encoded=true
  if (event.isBase64Encoded && typeof raw === 'string') {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {}
  }
  if (raw && typeof raw === 'object') return raw; // локальні дев-сценарії
  if (typeof raw !== 'string') return null;

  raw = raw.trim();
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();

  // 1) form-urlencoded або вигляд a=b&c=d
  if (ct.includes('application/x-www-form-urlencoded') || (!raw.startsWith('{') && raw.includes('='))) {
    return fromUrlEncoded(raw);
  }

  // 2) чистий JSON
  const obj = tryParseJSON(raw);
  if (obj) return obj;

  // 3) нічого не вийшло
  return null;
}
/* ------------------------------------------------------------- */

function signSid(sid) {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret).update(String(sid)).digest('base64url');
}
function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const A = Buffer.from(a, 'utf8');
  const B = Buffer.from(b, 'utf8');
  if (A.length !== B.length) return false;
  try { return crypto.timingSafeEqual(A, B); } catch { return false; }
}

let bcrypt = null;
try { bcrypt = require('bcryptjs'); } catch { try { bcrypt = require('bcrypt'); } catch { bcrypt = null; } }

/** Гнучке діставання користувача з різними схемами колонок */
async function getUserByUsername(username) {
  // варіант 1: password_hash + password
  const q1 = `
    SELECT id, username, role, password_hash, password
    FROM users
    WHERE username = $1
    LIMIT 1
  `;
  try {
    const { rows } = await pool.query(q1, [username]);
    if (rows.length) return rows[0];
  } catch (e) {
    // якщо undefined_column (42703) — спробуємо інший запит
    if (e && e.code !== '42703') throw e;
  }

  // варіант 2: тільки password (plain)
  const q2 = `
    SELECT id, username, role, password
    FROM users
    WHERE username = $1
    LIMIT 1
  `;
  try {
    const { rows } = await pool.query(q2, [username]);
    if (rows.length) return rows[0];
  } catch (e) {
    if (e && e.code !== '42703') throw e;
  }

  // варіант 3: без пароля (дозволить fallback на ADMIN_* env)
  const q3 = `
    SELECT id, username, role
    FROM users
    WHERE username = $1
    LIMIT 1
  `;
  const { rows } = a
