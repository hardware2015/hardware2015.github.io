# Businessmen United Club

Private FastAPI chat with manual BUC ID accounts, server-side sessions, PostgreSQL storage, and a minimal dark interface.

## Stack

- FastAPI
- PostgreSQL
- SQLAlchemy
- Jinja2 templates
- Vanilla JavaScript WebSocket client

## Features

- Landing page with centered Businessmen United Club intro
- Animated transition into login form
- Manual login only with BUC ID and password
- Shared live chat over WebSocket
- Message deletion by author or admin
- Server-side sessions in PostgreSQL
- Argon2 password hashing
- Security headers and login rate limiting

## Environment

Copy `.env.example` to `.env` and change the values.

Required values:

- `DATABASE_URL`

Recommended for production:

- `SECRET_KEY`
- `COOKIE_SECURE=true`
- `ALLOWED_HOSTS=your-app.up.railway.app,your-domain.com`

## Local run

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

For local `http://localhost` development, set `COOKIE_SECURE=false` in `.env` or login cookies will not be stored over plain HTTP.

## Create users

Run this after the app has started once, so tables exist:

```bash
python -m scripts.create_user --buc-id BUC001 --password "strong-password" --display-name "Member One" --role admin --color "#f0f0f0"
```

## Railway

Set these environment variables in Railway:

- `DATABASE_URL`
- `SECRET_KEY`
- `COOKIE_SECURE=true`
- `APP_ENV=production`
- `ALLOWED_HOSTS=your-app.up.railway.app`

Start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Use a PostgreSQL plugin or a separate PostgreSQL service on Railway, then paste the connection string into `DATABASE_URL`.

## Notes

- This app is intentionally simple and uses one FastAPI service.
- For a small private club this is enough.
- If you later scale to multiple instances, add Redis for WebSocket fan-out.
