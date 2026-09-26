# Design Sync

A collaborative system design interview workspace: a shared architecture canvas
with an audio room, chat, private interviewer notes, a waiting room, and
PNG/SVG/JSON export.

It is two components that can run separately or as one container:

| Path        | Component | Stack                                          |
| ----------- | --------- | ---------------------------------------------- |
| `backend/`  | REST + WebSocket API | FastAPI, SQLAlchemy, SQLite or Postgres, managed by `uv` |
| `frontend/` | Web UI    | React 19, TanStack Start/Router, Tailwind, Vite |

The API contract shared by both lives in [`openapi.yaml`](./openapi.yaml); the
product spec is in [`docs/`](./docs).

## Prerequisites

- **Docker** — for the container route, and nothing else.
- **[uv](https://docs.astral.sh/uv/)** and **Node.js 22+** — for running the
  components directly.

## Run with Docker

One image builds the frontend with Node, then serves those static files from the
Python backend, so the whole app is on a single port with no CORS involved.

```bash
docker build -t design-sync .
docker run --rm -p 8000:8000 -v design-sync-data:/app/data design-sync
```

Then open **<http://localhost:8000>**. The API is at `/api` on the same origin
and the interactive docs at <http://localhost:8000/docs>.

The named volume keeps `whiteboard.db` outside the container, so sessions
survive a restart. Drop the `-v` flag if you want a throwaway database.

### Pointing the UI at a different API origin

Vite inlines `import.meta.env` values into the client bundle, so the API origin
is fixed **when the image is built**, not when it runs. It defaults to the
same-origin `/api`. To target an API somewhere else, rebuild:

```bash
docker build -t design-sync \
  --build-arg VITE_API_URL=https://api.example.com/api .
```

> On Windows, run this from PowerShell, or prefix it with `MSYS_NO_PATHCONV=1`
> in Git Bash. MSYS rewrites a leading-slash value like `/api` into a Windows
> path, which silently bakes a broken URL into the bundle.

### Runtime configuration

| Variable         | Default                              | Purpose                            |
| ---------------- | ------------------------------------ | ---------------------------------- |
| `PORT`           | `8000`                               | Port the backend listens on        |
| `DATABASE_URL`   | `sqlite:////app/data/whiteboard.db`  | Any SQLAlchemy URL; see [Use Postgres](#use-postgres) |
| `FRONTEND_DIST`  | `/app/frontend/dist`                 | Static files to serve              |

## Run the components independently

Useful during development, since both sides get hot reload this way.

### Backend only

```bash
uv sync --directory backend
uv run --directory backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- API: <http://127.0.0.1:8000/api>
- Docs: <http://127.0.0.1:8000/docs>
- Writes `backend/whiteboard.db`; override with `DATABASE_URL`.

When `frontend/.output/public` has not been built, the backend serves the API
alone. If it *has* been built, the backend also serves that UI at `/` — handy
for checking a production build locally.

### Frontend only

```bash
npm install --prefix frontend
npm run dev --prefix frontend
```

The dev server runs on **<http://localhost:8080>** (the Lovable Vite config pins
this port). With no configuration it calls the backend at
`http://<hostname>:8000/api`, so starting the backend as above is enough.

To point it elsewhere, copy `frontend/.env.example` to `frontend/.env` and set
`VITE_API_URL`. Note that `backend/app/main.py` has an explicit CORS allowlist —
a new frontend origin has to be added there.

### Both at once

```bash
make install   # uv sync + npm install
make start     # backend on :8000 and frontend on :8080
```

`make help` lists the rest. On Windows `make start` opens a terminal window per
service; elsewhere it runs both in the foreground.

## Use Postgres

SQLite is the zero-config default and needs nothing running. Postgres takes over
whenever `DATABASE_URL` points at it — the schema is created on first start, the
same way it is for SQLite.

```bash
make db-up                     # postgres:16-alpine on :5432, data in a named volume
make run-backend-pg            # backend against postgresql+psycopg://sdip:sdip@localhost:5432/sdip
```

`make db-down` stops the container and keeps the data; `make db-reset` deletes
both the container and its volume; `make psql` opens a shell on it. To use a
database elsewhere, set the variable yourself:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://user:password@host:5432/dbname"
```

Notes on the URL and the schema:

- A driverless `postgres://` or `postgresql://` URL is rewritten to
  `postgresql+psycopg://`, so it works without installing `psycopg2`.
- From the app container, reach a Postgres on the Windows or macOS host as
  `host.docker.internal` rather than `localhost`:
  `docker run --rm -p 8000:8000 -e DATABASE_URL=postgresql+psycopg://sdip:sdip@host.docker.internal:5432/sdip design-sync`
- The session document is stored as `jsonb`, and each write takes a `SELECT …
  FOR UPDATE` row lock. That is what makes more than one backend worker against
  one database safe: a whole session is a single JSON row, so every write is a
  read-modify-write that would otherwise clobber a concurrent one.
- There are no migrations. Tables are created if missing, so a schema change
  means recreating them (`make db-reset`).

## Tests

```bash
make test                      # or: uv run --directory backend pytest
make test-pg                   # the same suite plus the Postgres integration tests
npm run lint --prefix frontend
```

`make test` needs no database: it runs on in-memory SQLite and skips the three
Postgres integration tests. `make test-pg` sets `TEST_DATABASE_URL` and runs
them against the `make db-up` container, including one that asserts two
independent stores writing concurrently lose no messages.

The backend suite passes clean. `npm run lint` currently reports pre-existing
Prettier formatting differences; `npm run format --prefix frontend` fixes them,
but it touches a large number of files. On Windows, a checkout with
`core.autocrlf=true` adds thousands of extra `Delete ␍` errors on top, because
the repository stores LF.

## How the two components connect

Nothing about the wiring is implicit, so it is worth stating:

- All session, participant, chat, presence, and diagram operations go through
  one interface, `InterviewApi` (`frontend/src/services/api/types.ts`). The
  implementation in `real-api.ts` is the only place that knows about HTTP.
- Live updates use a WebSocket at `/api/sessions/{id}/events`. Its URL is
  derived from `VITE_API_URL` by swapping `http` for `ws`, which is why a
  relative value gets resolved against the page origin first.
- The backend mounts every router twice: under `/api`, and at the root for
  deployments behind a proxy that already strips the prefix.
- In the container, `backend/app/static.py` serves the built frontend and falls
  back to `index.html` on unknown paths so client-side deep links such as
  `/room/<id>` work. Unmatched paths under `/api` still return a JSON 404.
- Because the frontend is built in SPA mode, the served HTML is a shell and
  React renders on the client. There is no server-side rendering in this setup.
