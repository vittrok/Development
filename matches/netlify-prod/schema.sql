CREATE TABLE matches (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    time TIME,
    team_home TEXT NOT NULL,
    team_away TEXT NOT NULL,
    competition TEXT,
    venue TEXT,
    referee TEXT
);
