# Netlify Neon Football Matches App

## Опис
Проста аплікація для завантаження матчів через CSV, зберігання у Neon Postgres DB (через Netlify Functions) та можливістю оновлювати поле "переглянуто" і видаляти матчі.

## Структура
- React фронтенд (src/App.jsx)
- Netlify Functions для API в netlify/functions
- Використовується Neon (Postgres) з Netlify DB

## Запуск локально
1. Встановіть залежності для функцій
```bash
cd netlify/functions
npm install
```
2. Налаштуйте `NETLIFY_DATABASE_URL` в .env (URL до вашої Neon бази)

3. Запустіть фронтенд (наприклад, create-react-app або vite)

4. Запустіть Netlify Dev для локальної емуляції функцій
```bash
netlify dev
```

## В Neon DB потрібно створити таблицю
```sql
CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  match VARCHAR(255) NOT NULL,
  tournament VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  link VARCHAR(255),
  viewed BOOLEAN DEFAULT FALSE
);
```

## Деплой
- Задеплойте проект на Netlify
- Задайте в Netlify Environment Variables `NETLIFY_DATABASE_URL`

---