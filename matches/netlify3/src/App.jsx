import React, { useState, useEffect } from 'react';

export default function App() {
  const [csvText, setCsvText] = useState('');
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);

  // Завантаження матчів
  async function fetchMatches() {
    const res = await fetch('/.netlify/functions/matches');
    const data = await res.json();
    setMatches(data);
  }

  useEffect(() => {
    fetchMatches();
  }, []);

  // Завантаження CSV у бекенд
  async function uploadCsv() {
    setLoading(true);
    const res = await fetch('/.netlify/functions/upload-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: csvText })
    });
    if (res.ok) {
      await fetchMatches();
      alert('CSV успішно завантажено');
      setCsvText('');
    } else {
      alert('Помилка при завантаженні CSV');
    }
    setLoading(false);
  }

  // Оновлення viewed
  async function toggleViewed(id, currentViewed) {
    await fetch('/.netlify/functions/matches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, viewed: !currentViewed })
    });
    fetchMatches();
  }

  // Видалення матчу
  async function deleteMatch(id) {
    if (!window.confirm('Видалити матч?')) return;
    await fetch('/.netlify/functions/delete-match', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    fetchMatches();
  }

  return (
    <div style={{ maxWidth: 900, margin: '20px auto', fontFamily: 'Arial, sans-serif' }}>
      <h1>Матчі</h1>

      <h2>Завантажити CSV</h2>
      <textarea
        rows={8}
        style={{ width: '100%' }}
        placeholder={`id,match,tournament,date,link
1,"Tottenham Hotspur vs Manchester United","Europa League Final","2025-05-21",""
2,"Crystal Palace vs Manchester City","FA Cup Final","2025-05-17",""
3,"Barcelona vs Real Madrid","Copa del Rey Final","2025-04-26",""`}
        value={csvText}
        onChange={e => setCsvText(e.target.value)}
        disabled={loading}
      />
      <button onClick={uploadCsv} disabled={loading} style={{ marginTop: 10 }}>
        Завантажити CSV
      </button>

      <h2>Список матчів</h2>
      <table border="1" cellPadding="6" cellSpacing="0" style={{ width: '100%', marginTop: 10 }}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Матч</th>
            <th>Турнір</th>
            <th>Дата</th>
            <th>Посилання</th>
            <th>Переглянуто</th>
            <th>Дії</th>
          </tr>
        </thead>
        <tbody>
          {matches.map(({ id, match, tournament, date, link, viewed }) => (
            <tr key={id}>
              <td>{id}</td>
              <td>{match}</td>
              <td>{tournament}</td>
              <td>{date}</td>
              <td>
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer">
                    Посилання
                  </a>
                ) : (
                  '-'
                )}
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={viewed}
                  onChange={() => toggleViewed(id, viewed)}
                />
              </td>
              <td>
                <button onClick={() => deleteMatch(id)}>Видалити</button>
              </td>
            </tr>
          ))}
          {matches.length === 0 && (
            <tr>
              <td colSpan="7" style={{ textAlign: 'center' }}>
                Немає матчів
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}