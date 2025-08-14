// netlify/functions/update-matches.js (CommonJS)
exports.handler = async function (event, context) {
  try {
    await client.connect();

    // Приклад: отримати всі матчі
    const { rows: matches } = await client.query("SELECT * FROM matches ORDER BY match_date DESC");

    // Приклад: оновити поле seen для певного матчу
    // event.body очікує JSON { id: <match_id>, seen: true/false }
    if (event.body) {
      const { id, seen } = JSON.parse(event.body);
      await client.query("UPDATE matches SET seen = $1 WHERE id = $2", [seen, id]);
    }

    await client.end();

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