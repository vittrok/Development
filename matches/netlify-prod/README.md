# Football Matches Tracker (Netlify + Neon)

Static HTML/JS front-end on Netlify with serverless functions that persist state in a Neon Postgres DB.

## Quick start

1) Create a Neon Postgres database and copy its connection string (DATABASE_URL).
2) In Netlify site settings → Environment variables, add `DATABASE_URL` with that value.
3) (Optional for local import) Copy `.env.example` to `.env` and set `DATABASE_URL`.
4) Put your matches in `data/matches.csv` (headers: match,tournament,date,link).
5) Run: `npm install` then `npm run updateMatches` (from your machine) to seed the DB.
6) Deploy the repo on Netlify. The static site is in `/public`, functions are in `/functions`.

State (seen, color, sorting) is stored in Postgres, so it syncs across devices.
