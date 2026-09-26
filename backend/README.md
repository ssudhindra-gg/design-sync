# Whiteboard IV backend

FastAPI implementation of the contract in the repository-root `openapi.yaml`.
The service uses SQLAlchemy with SQLite by default and seeds a demo account and
session on startup. Set `DATABASE_URL` to any SQLAlchemy-supported database URL
to use another database; Postgres is supported and tested.

```powershell
cd backend
uv sync
$env:DATABASE_URL = "sqlite:///./whiteboard.db"
uv run uvicorn app.main:app --reload
uv run pytest
```

For Postgres, `make db-up` and `make run-backend-pg` from the repository root do
the whole thing; `make test-pg` adds the integration tests. The equivalent by
hand:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://sdip:sdip@localhost:5432/sdip"
uv run uvicorn app.main:app --reload
$env:TEST_DATABASE_URL = $env:DATABASE_URL   # opts the integration tests in
uv run pytest
```

A driverless `postgres://` or `postgresql://` URL is rewritten to use psycopg 3.
The root [README](../README.md#use-postgres) covers the rest: the `jsonb`
column, the row lock that makes multiple workers safe, and the absence of
migrations.

Demo account:

- username: `interviewer@example.com`
- password: `demo-password`
- seeded session: `demo-session`

The API is available under `/api` (for example, `/api/auth/login` and
`/api/sessions/demo-session`). A root route alias is also available when a
reverse proxy already strips `/api`. Account passwords are stored as scrypt
hashes. Login returns an account bearer token; session creation and guest join
also establish a scoped `ParticipantSession` cookie for session mutations.
