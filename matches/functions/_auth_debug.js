// matches/netlify-prod/functions/_auth_debug.js
// Мікрокрок 18.4.0.16: ДІАГНОСТИЧНИЙ обгортчик requireAuth.
// Поведінку НЕ змінюємо — лише логуємо рішення (2xx/4xx/throw), шлях і коротку причину.
// Після діагностики цей файл буде прибрано.

const base = require('./_utils');

function wrapRequireAuth(origRequireAuth) {
  return function (...args) {
    // ВАРІАНТ A: HOF -> requireAuth(handler) -> (event, context) => response
    if (typeof args[0] === 'function' && args.length === 1) {
      const handler = args[0];
      const wrapped = origRequireAuth(handler);
      if (typeof wrapped !== 'function') {
        console.warn('[auth_debug] WARN: requireAuth(handler) did not return a function. Falling back to (event, context, handler) style.');
        return async function (event, context) {
          try {
            const res = await origRequireAuth(event, context, handler);
            logDecision('[auth_debug]', event, res, null);
            return res;
          } catch (e) {
            logDecision('[auth_debug]', event, null, e);
            throw e;
          }
        };
      }
      return async function (event, context) {
        try {
          const res = await wrapped(event, context);
          logDecision('[auth_debug]', event, res, null);
          return res;
        } catch (e) {
          logDecision('[auth_debug]', event, null, e);
          throw e;
        }
      };
    }

    // ВАРІАНТ B: requireAuth(event, context, handler) -> response
    const [event, context, handler] = args;
    return (async () => {
      try {
        const res = await origRequireAuth(event, context, handler);
        logDecision('[auth_debug]', event, res, null);
        return res;
      } catch (e) {
        logDecision('[auth_debug]', event, null, e);
        throw e;
      }
    })();
  };
}

function logDecision(tag, event, res, err) {
  try {
    const path = event?.path;
    const rawUrl = event?.rawUrl;
    const code = typeof res?.statusCode === 'number' ? res.statusCode : null;
    let preview = '';
    if (res && code && code >= 400) {
      try {
        const b = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? '');
        preview = String(b).slice(0, 120);
      } catch {}
    }
    const h = event?.headers || {};
    const hasCookie  = typeof h.cookie === 'string' && /session=/.test(h.cookie);
    const hasCsrfHdr = typeof h['x-csrf'] === 'string' && h['x-csrf'].length > 0;
    const hasOrigin  = typeof h['origin'] === 'string';
    const hasReferer = typeof h['referer'] === 'string';
    const hasXReq    = typeof h['x-requested-with'] === 'string';

    if (err) {
      console.warn(`${tag} THROW`, JSON.stringify({ path, rawUrl, hasCookie, hasCsrfHdr, hasOrigin, hasReferer, hasXReq, error: String(err?.message || err) }));
    } else if (code && code >= 400) {
      console.warn(`${tag} RETURN ${code}`, JSON.stringify({ path, rawUrl, hasCookie, hasCsrfHdr, hasOrigin, hasReferer, hasXReq, bodyPreview: preview }));
    } else {
      console.log(`${tag} OK`, JSON.stringify({ path, rawUrl, hasCookie, hasCsrfHdr, hasOrigin, hasReferer, hasXReq, statusCode: code ?? 200 }));
    }
  } catch (e) {
    console.warn('[auth_debug] logDecision failed:', String(e?.message || e));
  }
}

module.exports = {
  ...base,
  requireAuth: wrapRequireAuth(base.requireAuth),
};
