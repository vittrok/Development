// functions/setSeenColor.js — legacy endpoint (soft-deprecated)

const APP_ORIGIN = process.env.APP_ORIGIN || "https://football-m.netlify.app";

function headers(json = true) {
  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-CSRF, Cookie",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Cache-Control": "no-cache",
    "Content-Type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Deprecation": "true",
    "Sunset": "Fri, 19 Sep 2025 00:00:00 GMT",
    'Link': '</.netlify/functions/preferences>; rel="successor-version"'
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: headers(), body: "" };
  }
  console.warn("[setSeenColor] legacy endpoint hit; return 410");
  return {
    statusCode: 410,
    headers: headers(),
    body: JSON.stringify({ ok: false, error: "gone", use: "/.netlify/functions/preferences" })
  };
};
// Return 410 Gone and point clients to /preferences