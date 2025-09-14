// matches/netlify-prod/functions/_util/confidence.js
// Обчислення home_away_confidence згідно архітектури v1.1:
// Повертає одне з: "high" | "medium" | "low"

const { canonicalizeTeam, normalizeForAliasKey } = require('./canon');

// Допоміжні regex-и для джерельних міток
const HOME_HINT = /\b(home|host|h)\b/i;
const AWAY_HINT = /\b(away|visitor|a)\b/i;

// Кожне правило додає бали до score. Градація: score >= 80 -> high, >= 45 -> medium, інакше low.
function evaluateConfidenceRow(row) {
  const reasons = [];
  let score = 0;

  const tournament = String(row.tournament || '');
  const link = String(row.link || '');
  const meta = row.meta || {}; // опційно: flags, rawHomeLabel, rawAwayLabel

  // 1) Явні теги від парсера (найсильніше)
  if (meta.flags && (meta.flags.homeTagged || meta.flags.awayTagged)) {
    score += 60;
    reasons.push('parser_tags');
  }

  // 2) Відомі сильні офіційні джерела у link (домен)
  if (/\b(uefa|fifa|premierleague|laliga|bundesliga|seriea|ligue1|ekstraklasa|facup|dfb)\b/i.test(link)) {
    score += 30;
    reasons.push('official_competition_site');
  }

  // 3) Турнір з чіткою структурою (дом/виїзд)
  if (/\b(uefa|champions league|europa league|conference league|euro qualifiers|world cup qualifiers|qualifiers|premier league|la liga|bundesliga|serie a|ligue 1|ekstraklasa|fa cup|dfb-pokal)\b/i.test(tournament)) {
    score += 20;
    reasons.push('structured_competition');
  }

  // 4) Лінгвістичні підказки
  if (meta.rawHomeLabel && HOME_HINT.test(meta.rawHomeLabel)) {
    score += 20;
    reasons.push('home_label_hint');
  }
  if (meta.rawAwayLabel && AWAY_HINT.test(meta.rawAwayLabel)) {
    score += 20;
    reasons.push('away_label_hint');
  }

  // 5) Самозгодженість alias-канонікалізації
  const homeCanon = canonicalizeTeam(row.home_team);
  const awayCanon = canonicalizeTeam(row.away_team);
  const homeKey = normalizeForAliasKey(homeCanon);
  const awayKey = normalizeForAliasKey(awayCanon);
  if (homeKey && awayKey && homeKey !== awayKey) {
    score += 5;
    reasons.push('sane_distinct_teams');
  }

  // Нормалізуємо score в [0..100]
  if (score > 100) score = 100;
  if (score < 0) score = 0;

  // 🔧 Пороги: medium з 50 → 45, щоб "Only linguistic hints" із 45 балами був medium
  const level = score >= 80 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { level, score, reasons };
}

/**
 * Головна функція для зовнішнього використання.
 * Очікує об'єкт з полями:
 * {
 *   home_team, away_team, tournament?, link?, source?, meta?: { flags?, rawHomeLabel?, rawAwayLabel? }
 * }
 */
function computeHomeAwayConfidence(row) {
  return evaluateConfidenceRow(row);
}

module.exports = {
  computeHomeAwayConfidence
};
