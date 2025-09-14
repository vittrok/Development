// matches/netlify-prod/functions/_util/canon.js
// Утиліти для нормалізації команд і побудови pair_key згідно v1.1 архітектури.

const fs = require('fs');
const path = require('path');

let _aliasMapCache = null;

// Прибрати діакритики: Barça -> Barca; München -> Munchen
function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Нормалізація для ключів alias_map: lower, trim, діакритики, пунктуація → пробіли, мультипробіли → один
function normalizeForAliasKey(team) {
  if (!team) return '';
  const lowered = stripDiacritics(String(team).toLowerCase());
  const lettersSpaces = lowered.replace(/[^a-z0-9\s]/g, ' ');
  const singleSpaced = lettersSpaces.replace(/\s+/g, ' ').trim();
  return singleSpaced;
}

function loadAliasMap() {
  if (_aliasMapCache) return _aliasMapCache;
  const aliasPath = path.join(process.cwd(), 'data', 'alias_map.json');
  const raw = fs.readFileSync(aliasPath, 'utf8');
  const originalObj = JSON.parse(raw);

  // 🔧 ВАЖЛИВО: будуємо нормалізовану мапу ключів, щоб "u-21" == "u 21" == "U21"
  const normalized = {};
  for (const [k, v] of Object.entries(originalObj)) {
    const nk = normalizeForAliasKey(k);
    normalized[nk] = String(v).trim();
  }

  _aliasMapCache = normalized;
  return _aliasMapCache;
}

// Канонічна назва з урахуванням alias_map; якщо відсутня — повертаємо оригінал як є
function canonicalizeTeam(team) {
  const alias = loadAliasMap();
  const key = normalizeForAliasKey(team);
  const mapped = alias[key];
  return mapped || String(team).trim();
}

// Побудова order-independent ключа пари
function buildPairKey(homeCanon, awayCanon) {
  return [homeCanon, awayCanon].sort((a, b) => a.localeCompare(b, 'en')).join('|');
}

// Комплексна утиліта для матчу
function canonicalizePair(homeTeam, awayTeam) {
  const homeCanon = canonicalizeTeam(homeTeam);
  const awayCanon = canonicalizeTeam(awayTeam);
  const pairKey = buildPairKey(homeCanon, awayCanon);
  return { homeCanon, awayCanon, pairKey };
}

module.exports = {
  stripDiacritics,
  normalizeForAliasKey,
  canonicalizeTeam,
  buildPairKey,
  canonicalizePair
};
