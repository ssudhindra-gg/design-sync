# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 - build the frontend with Node into static files.
#
# The app is built in SPA mode (frontend/vite.config.ts), so this stage emits a
# static shell plus hashed assets rather than a server bundle. Nothing from Node
# survives into the final image.
#
# VITE_API_URL is a build argument, not a runtime variable: Vite inlines
# import.meta.env values into the client bundle, so the origin the browser calls
# is fixed at build time. The default "/api" is same-origin, which is what the
# backend serves the bundle on.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS frontend

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

ARG VITE_API_URL=/api
ARG VITE_API_USERNAME=interviewer@example.com
ARG VITE_API_PASSWORD=demo-password
RUN npm run build \
    # Fail loudly here rather than serving a 404 at runtime.
    && test -f .output/public/index.html


# ---------------------------------------------------------------------------
# Stage 2 - the Python runtime: the backend plus the static files it serves.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv

ENV UV_PYTHON=/usr/local/bin/python3 \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PATH="/app/backend/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend

# Dependencies first so they stay cached when only application code changes.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./
RUN uv sync --frozen --no-dev

COPY --from=frontend /build/.output/public /app/frontend/dist

ENV FRONTEND_DIST=/app/frontend/dist \
    DATABASE_URL=sqlite:////app/data/whiteboard.db \
    PORT=8000

# Keep the SQLite file on a volume so sessions survive a container restart.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ['PORT']+'/openapi.json').read()"]

# Shell form so $PORT is expanded; uvicorn then replaces the shell.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
