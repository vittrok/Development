// netlify/functions/update-matches.js (CommonJS)
exports.handler = async function (event, context) {
  try {
    // TODO: тут буде реальна логіка синку з Neon
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, message: "Stub sync ran" }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: String(err) }),
    };
  }
};
