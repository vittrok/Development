BEGIN;

-- 5.1.d Backfill NULL status and league (idempotent)

-- 1) STATUS: якщо ще NULL
--    - 'scheduled' для майбутніх матчів
--    - 'finished' для минулих
UPDATE matches
SET status = CASE WHEN kickoff_at >= NOW() THEN 'scheduled' ELSE 'finished' END
WHERE status IS NULL;

-- 2) LEAGUE: якщо ще NULL — проставляємо під відомі пари команд
-- Англійська Прем'єр-ліга
UPDATE matches
SET league = 'EPL'
WHERE league IS NULL AND (home_team, away_team) IN (
        ('Nottingham Forest','Manchester City'),
        ('Crystal Palace','Manchester City'),
        ('Newcastle United','Liverpool'),
        ('Liverpool','Manchester United'),
        ('Tottenham Hotspur','Manchester United'),
        ('Liverpool','Southampton'),
        ('Manchester City','Queens Park Rangers'),
        ('Manchester United','Arsenal'),
        ('Arsenal','Chelsea')
);

-- Бундесліга
UPDATE matches
SET league = 'Bundesliga'
WHERE league IS NULL AND (home_team, away_team) IN (
        ('Borussia Dortmund','Schalke'),
        ('Bayern Munich','Wolfsburg')
);

-- Ла Ліга (конкретно ці матчі)
UPDATE matches
SET league = 'LaLiga'
WHERE league IS NULL AND (home_team, away_team) IN (
        ('Barcelona','Real Madrid')
);

-- Ліга чемпіонів УЄФА (UCL) — відомі історичні пари
UPDATE matches
SET league = 'UCL'
WHERE league IS NULL AND (home_team, away_team) IN (
        ('Chelsea','Barcelona'),
        ('Liverpool','Barcelona'),
        ('Barcelona','PSG'),
        ('Barcelona','Inter Milan'),
        ('AC Milan','Liverpool'),
        ('Real Madrid','Atlético Madrid'),
        ('Tottenham Hotspur','Ajax'),
        ('Chelsea','Bayern Munich')
);

-- Збірні (міжнародні)
UPDATE matches
SET league = 'International'
WHERE league IS NULL AND (home_team, away_team) IN (
        ('Italy','Germany'),
        ('Spain','Netherlands'),
        ('Argentina','France'),
        ('Brazil','Germany')
);

-- Клубні єврокубки (узагальнено), якщо турнір не уточнюємо
UPDATE matches
SET league = 'UEFA'
WHERE league IS NULL AND (home_team, away_team) IN (
        ('Bodø/Glimt','Lazio')
);

COMMIT;
