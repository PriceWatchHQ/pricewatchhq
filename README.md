# PriceWatch HQ

Competitor price monitoring SaaS. Track prices across the web and get alerted when they change.

## Stack

- **Runtime**: Node.js (ES modules)
- **Framework**: Fastify
- **Scraping**: Cheerio + node-fetch
- **Scheduling**: node-cron (hourly price checks)
- **Database**: SQLite via better-sqlite3
- **Frontend**: Plain HTML/CSS landing page

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.example .env

# 3. Start the server
npm start
```

The server starts on `http://localhost:3000`. The SQLite database is created automatically in `data/pricewatchhq.db` on first run.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/urls` | Add a URL to monitor (`{ url, label?, user_id? }`) |
| `GET` | `/api/urls` | List all watched URLs |
| `DELETE` | `/api/urls/:id` | Remove a watched URL |
| `GET` | `/api/prices/:urlId` | Get price history for a URL |
| `POST` | `/api/waitlist` | Join the waitlist (`{ email }`) |

## How It Works

1. Add URLs you want to monitor via the API.
2. Every hour, the scheduler scrapes each URL and extracts the price using common selectors (`.price`, `[class*=price]`, `[itemprop=price]`).
3. Price changes are logged to `price_history` and alerts are printed to the console.
4. Query the price history API to see trends over time.

## Development

```bash
# Run with auto-restart on file changes
npm run dev
```
