// matches/netlify-prod/functions/scheduled-update-matches.js
// Scheduled Function (Netlify): виконується за CRON і запускає наш БД-мердж.
// Розклад можна змінити у exports.config.schedule (CRON).

const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!connectionString) {
  console.warn("[scheduled-update-matches] Missing DATABASE_URL/NEON_DATABASE_URL env");
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// CRON: щогодини на нульовій хвилині (UTC).
exports.config = {
  schedule: "0 * * * *",
};

exports.handler = async () => {
  try {
    // Викликаємо одну БД-функцію з trigger_type='cron'
    const { rows } = await pool.query(
      "SELECT run_staging_validate_and_merge($1,$2,$3) AS result",
      ["cron", "scheduler", null]
    );

    const result = rows?.[0]?.result ?? null;
    // Повернення тут лише для логів Netlify; це не HTTP endpoint.
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, result }),
    };
  } catch (err) {
    console.error("[scheduled-update-matches] Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "Internal Error" }),
    };
  }
};
