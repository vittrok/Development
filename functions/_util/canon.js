// matches/netlify-prod/functions/_util/canon.js
// Утиліти для нормалізації команд і побудови pair_key згідно v1.1 архітектури.

const fs = require('fs');
const path = require('path');

let _aliasMapCache = null;

function loadAliasMap() {
  if (_aliasMapCache) return _aliasMapCache;
  const aliasPath = path.join(process.cwd(), 'data', 'alias_map.json');
  const raw = fs.readFileSync(aliasPath, 'utf8');
  const obj = JSON.parse(raw);
  _aliasMapCache = obj;
  return _aliasMapCache;
}

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeForAliasKey(team) {
  if (!team) return '';
  const lowered = stripDiacritics(String(team).toLowerCase());
  const lettersSpaces = lowered.replace(/[^a-z0-9\s]/g, ' ');
  const singleSpaced = lettersSpaces.replace(/\s+/g, ' ').trim();
  return singleSpaced;
}

function canonicalizeTeam(team) {
  const alias = loadAliasMap();
  const key = normalizeForAliasKey(team);
  const mapped = alias[key];
  return mapped || String(team).trim();
}

function buildPairKey(homeCanon, awayCanon) {
  return [homeCanon, awayCanon].sort((a, b) => a.localeCompare(b, 'en')).join('|');
}

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
