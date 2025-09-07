// POST /update-matches
// Архітектурні вимоги v1.1: rate limits (global/IP), sync_lock, idempotency
// Тимчасово збережено OUT-OF-ARCH X-Update-Token (альтернатива Authorization: Bearer)
// Пізніше замінимо на cookie-сесії + CSRF (крок 7.3).

const { Pool } = require("pg");

// ==== CORS/Headers ===========================================================
const ORIGIN = "https://football-m.netlify.app"; // прод-оригін
const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With, X-CSRF, X-Update-Token, Idempotency-Key",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function json(status, obj, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { ...corsHeaders, ...extraHeaders },
    body: JSON.stringify(obj),
  };
}
function normStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

// ==== ENV/DB =================================================================
const connectionString =
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const UPDATE_TOKEN = process.env.UPDATE_TOKEN || null;

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// ==== Helpers: client IP =====================================================
function getClientIp(event) {
  const h = event.headers || {};
  // Netlify typical headers:
  // x-nf-client-connection-ip (single IP) or x-forwarded-for (list)
  const ip1 = h["x-nf-client-connection-ip"] || h["X-Nf-Client-Connection-Ip"];
  if (ip1) return String(ip1).trim();
  const xff = h["x-forwarded-for"] || h["X-Forwarded-For"];
  if (xff) return String(xff).split(",")[0].trim();
  return "0.0.0.0";
}

// ==== Rate Limit (Fixed Window) ==============================================
// Tables per arch: rate_limits(key PK, count int, reset_at timestamptz)
//
// Policies for this endpoint (until cookie sessions land):
// - Global: 1/2m
// - IP: 1/5m
const RL_GLOBAL_KEY = "global:update-matches";
const RL_GLOBAL_LIMIT = 1;
const RL_GLOBAL_WINDOW_SEC = 120;

function rlIpKey(ip) {
  return `ip:${ip}:update-matches`;
}
const RL_IP_LIMIT = 1;
const RL_IP_WINDOW_SEC = 300;

async function applyRateLimit(client, key, limit, windowSec) {
  // Now (UTC)
  const resNow = await client.query("SELECT now() AS now");
  const now = new Date(resNow.rows[0].now);
  const resetAt = new Date(now.getTime() + windowSec * 1000);

  // Upsert fixed window:
  // - If existing and reset_at > now: increment count
  // - If existing but window passed: reset count=1, reset_at = now + window
  // - If new: insert count=1
  const upsert = await client.query(
    `
    INSERT INTO rate_limits(key, count, reset_at)
    VALUES ($1, 1, $2)
    ON CONFLICT (key)
    DO UPDATE SET
      count = CASE
        WHEN rate_limits.reset_at > now() THEN rate_limits.count + 1
        ELSE 1
      END,
      reset_at = CASE
        WHEN rate_limits.reset_at > now() THEN rate_limits.reset_at
        ELSE $2
      END
    RETURNING count, reset_at
  `,
    [key, resetAt.toISOString()]
  );

  const { count, reset_at } = upsert.rows[0];
  if (count > limit) {
    // Too many requests; compute Retry-After
    const raSec = Math.max(
      1,
      Math.ceil((new Date(reset_at).getTime() - now.getTime()) / 1000)
    );
    return { limited: true, retryAfter: raSec };
  }
  return { limited: false };
}

// ==== Sync Lock via settings.sync_lock =======================================
// settings(key PK text, value jsonb); key='sync_lock', value={ locked_till: timestamptz }
const LOCK_KEY = "sync_lock";
const LOCK_HOLD_SEC = 180; // 3 хв за архітектурою 3–5 хв

async function loadLock(client) {
  const r = await client.query(
    `SELECT value FROM settings WHERE key = $1`,
    [LOCK_KEY]
  );
  if (!r.rowCount) return null;
  try {
    return r.rows[0].value;
  } catch {
    return null;
  }
}
async function setLock(client, untilIso) {
  await client.query(
    `
    INSERT INTO settings(key, value)
    VALUES ($1, jsonb_build_object('locked_till', $2::timestamptz))
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value
    `,
    [LOCK_KEY, untilIso]
  );
}

// ==== Idempotency via sync_logs ==============================================
// sync_logs(id PK, started_at, finished_at, status, inserted, updated, skipped,
//           source, actor_user_id, idempotency_key, note/error)
async function findByIdemKey(client, key) {
  if (!key) return null;
  const r = await client.query(
    `SELECT * FROM sync_logs WHERE idempotency_key = $1
     ORDER BY started_at DESC LIMIT 1`,
    [key]
  );
  return r.rowCount ? r.rows[0] : null;
}
async function insertSyncLogStart(client, idemKey, source) {
  const r = await client.query(
    `
    INSERT INTO sync_logs(started_at, status, inserted, updated, skipped, source, idempotency_key)
    VALUES (now(), 'ok', 0, 0, 0, $1, $2)
    RETURNING id, started_at
  `,
    [source || "manual", idemKey || null]
  );
  return r.rows[0];
}
async function updateSyncLogFinish(client, id, status, counters, noteOrErr) {
  const { inserted = 0, updated = 0, skipped = 0 } = counters || {};
  await client.query(
    `
    UPDATE sync_logs
    SET finished_at = now(),
        status = $2,
        inserted = $3,
        updated = $4,
        skipped = $5,
        ${status === "failed" ? `error = $6` : `note = $6`}
    WHERE id = $1
  `,
    [id, status, inserted, updated, skipped, noteOrErr || null]
  );
}

// ==== Main Handler ===========================================================
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: corsHeaders, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    // --- OUT OF ARCH token guard (тимчасово) --------------------------------
    if (UPDATE_TOKEN) {
      const auth =
        event.headers.authorization ||
        event.headers.Authorization ||
        "";
      const xu =
        (event.headers["x-update-token"] || event.headers["X-Update-Token"] || "").trim();

      const token = auth.startsWith("Bearer ")
        ? auth.slice("Bearer ".length).trim()
        : (xu || "");

      if (!token || token !== UPDATE_TOKEN) {
        return json(401, { ok: false, error: "Unauthorized" });
      }
    }

    // --- Robust body parse ---------------------------------------------------
    let raw = event.body || "";
    if (raw && event.isBase64Encoded) {
      try {
        raw = Buffer.from(raw, "utf8").toString("utf8");
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body (b64 decode)" });
      }
    }
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }
    }

    const trigger_type = normStr(body.trigger_type) || "manual";
    const source = normStr(body.source) || "manual";
    const import_batch_id = normStr(body.import_batch_id) || null;

    // Idempotency
    const idemKey =
      normStr(event.headers["idempotency-key"]) ||
      normStr(event.headers["Idempotency-Key"]) ||
      "";

    const clientIp = getClientIp(event);

    const client = await pool.connect();
    try {
      // 1) Rate limits (IP → Global)
      await client.query("BEGIN");

      const rlIp = await applyRateLimit(
        client,
        rlIpKey(clientIp),
        RL_IP_LIMIT,
        RL_IP_WINDOW_SEC
      );
      if (rlIp.limited) {
        await client.query("ROLLBACK");
        return json(429, { ok: false, error: "rate_limited_ip" }, { "Retry-After": String(rlIp.retryAfter) });
      }

      const rlGlobal = await applyRateLimit(
        client,
        RL_GLOBAL_KEY,
        RL_GLOBAL_LIMIT,
        RL_GLOBAL_WINDOW_SEC
      );
      if (rlGlobal.limited) {
        await client.query("ROLLBACK");
        return json(429, { ok: false, error: "rate_limited_global" }, { "Retry-After": String(rlGlobal.retryAfter) });
      }

      // 2) Idempotency quick check
      if (idemKey) {
        const prev = await findByIdemKey(client, idemKey);
        if (prev && prev.status === "ok") {
          await client.query("COMMIT");
          return json(200, { ok: true, duplicate: true, result: {
            inserted: prev.inserted || 0,
            updated: prev.updated || 0,
            skipped: prev.skipped || 0,
          }});
        }
      }

      // 3) Sync Lock
      const nowRow = await client.query("SELECT now() AS now");
      const now = new Date(nowRow.rows[0].now);
      const lock = await loadLock(client);
      const lockedTill = lock?.locked_till ? new Date(lock.locked_till) : null;

      if (lockedTill && lockedTill > now) {
        await client.query("ROLLBACK");
        return json(204, { status: "locked_until", locked_till: lockedTill.toISOString() });
      }
      // set new lock = now + LOCK_HOLD_SEC
      const until = new Date(now.getTime() + LOCK_HOLD_SEC * 1000).toISOString();
      await setLock(client, until);

      // 4) Start sync_log
      const log = await insertSyncLogStart(client, idemKey, source);

      // 5) Do merge
      let counters = { inserted: 0, updated: 0, skipped: 0 };
      try {
        const res = await client.query(
          `SELECT * FROM run_staging_validate_and_merge($1, $2, $3)`,
          [trigger_type, source, import_batch_id]
        );

        // Очікуємо повертати total/inserted/updated/skipped (залежно від БД-функції)
        const row = res.rows?.[0] || null;

        // Узгодимо поля лічильників з архітектурою (inserted/updated/skipped):
        if (row && row.run_staging_validate_and_merge) {
          // Якщо БД повертає як composite
          const v = row.run_staging_validate_and_merge;
          counters = {
            inserted: Number(v.inserted || 0),
            updated: Number(v.updated || 0),
            skipped: Number(v.skipped || 0),
          };
        } else {
          // або пробуємо напряму з полів:
          counters = {
            inserted: Number(row?.inserted || 0),
            updated: Number(row?.updated || 0),
            skipped: Number(row?.skipped || 0),
          };
        }

        await updateSyncLogFinish(client, log.id, "ok", counters, "completed");
        await client.query("COMMIT");

        return json(200, { ok: true, result: counters });
      } catch (e) {
        await updateSyncLogFinish(client, log.id, "failed", { inserted: 0, updated: 0, skipped: 0 }, String(e?.message || e));
        await client.query("ROLLBACK");
        return json(500, { ok: false, error: "db_failed" });
      }
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[update-matches] fatal:", e);
    return json(500, { ok: false, error: "internal" });
  }
};
