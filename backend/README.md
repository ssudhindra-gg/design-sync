# Whiteboard IV backend

FastAPI implementation of the contract in the repository-root `openapi.yaml`.
The service uses an in-memory store and seeds a demo account and session on
startup.

```powershell
cd backend
uv sync
uv run uvicorn app.main:app --reload
uv run pytest
```

Demo account:

- username: `interviewer@example.com`
- password: `demo-password`
- seeded session: `demo-session`

The API is available under `/api` (for example, `/api/auth/login` and
`/api/sessions/demo-session`). A root route alias is also available when a
reverse proxy already strips `/api`. Account passwords are stored as scrypt
hashes. Login returns an account bearer token; session creation and guest join
also establish a scoped `ParticipantSession` cookie for session mutations.
