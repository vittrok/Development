// matches/netlify-prod/functions/_util/canonicalize.js
// Архітектура v1.1: п.6 Canonicalization & Uniqueness, п.7 Sync Process.
// Працюємо з існуючим форматом data/alias_map.json: { "man utd": "Manchester United", ... }
// Порівняння без урахування регістру; якщо ключ не знайдено — повертаємо вхідну назву.

const fs = require('fs');
const path = require('path');

let _aliasMap = null;

/** Нормалізуємо ключ: trim + toLowerCase + одиничні пробіли всередині */
function _normKey(s) {
  if (typeof s !== 'string') return s;
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Лazy-load та підготовка Map з нормалізованими ключами */
function _loadAliasMap() {
  if (_aliasMap) return _aliasMap;
  const jsonPath = path.join(__dirname, '..', '..', 'data', 'alias_map.json');
  let raw;
  try {
    raw = fs.readFileSync(jsonPath, 'utf8');
  } catch (e) {
    throw new Error(`alias_map.json not found at ${jsonPath}: ${e.message}`);
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(`alias_map.json parse error: ${e.message}`);
  }
  const m = new Map();
  for (const [k, v] of Object.entries(obj)) {
    const nk = _normKey(k);
    if (nk) m.set(nk, v);
  }
  _aliasMap = m;
  return _aliasMap;
}

/** Канонізує одну назву */
function canonicalizeTeam(name) {
  if (!name || typeof name !== 'string') return name;
  const map = _loadAliasMap();
  const hit = map.get(_normKey(name));
  return hit || name;
}

/** Пара: канонізує обидві й повертає pairKey (незалежний від порядку) */
function makePairKey(homeCanon, awayCanon) {
  const a = [String(homeCanon || ''), String(awayCanon || '')].sort();
  return a.join('|');
}

function canonicalizePair(homeName, awayName) {
  const homeCanon = canonicalizeTeam(homeName);
  const awayCanon = canonicalizeTeam(awayName);
  const pairKey = makePairKey(homeCanon, awayCanon);
  return { homeCanon, awayCanon, pairKey };
}

module.exports = {
  canonicalizeTeam,
  canonicalizePair,
  makePairKey,
  // для тестів
  _normKey,
  _loadAliasMap
};
