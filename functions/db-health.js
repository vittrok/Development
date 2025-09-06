const { Client } = require("pg");

exports.handler = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return {
      statusCode: 500,
      body: "No DATABASE_URL in env vars",
    };
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const db = await client.query("SELECT current_database()");
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public'
      ORDER BY table_name
    `);

    return {
      statusCode: 200,
      body: JSON.stringify({
        database: db.rows[0].current_database,
        tables: tables.rows.map(r => r.table_name),
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  } finally {
    await client.end();
  }
};
