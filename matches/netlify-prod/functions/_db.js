const { Client } = require('pg');

function getClient() {
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL is not set');
  const client = new Client({
    connectionString: cs,
    ssl: { rejectUnauthorized: false },
  });
  return client;
}

module.exports = { getClient };
