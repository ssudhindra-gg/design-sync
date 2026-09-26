"""Serves the built frontend from the backend process.

The frontend is built in SPA mode (see ../../frontend/vite.config.ts), so the
build output is a static shell plus hashed assets. Serving it here keeps the API
and the UI on one origin, which removes the need for CORS and for a second
process in front of the app.

Mounting is optional: when the build output is absent -- local backend-only
development, and the test suite -- the API behaves exactly as it did before.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Routes the SPA fallback must never answer: these belong to the API or to
# FastAPI's own docs, and a miss under them is a genuine 404, not a page.
_API_PREFIXES = ("api/", "docs", "redoc", "openapi.json")


def frontend_dist() -> Path | None:
    """Locate the built frontend, or return None when it has not been built."""
    configured = os.getenv("FRONTEND_DIST")
    candidates = (
        [Path(configured)]
        if configured
        else [Path(__file__).resolve().parents[2] / "frontend" / ".output" / "public"]
    )
    return next((c for c in candidates if (c / "index.html").is_file()), None)


def mount_frontend(app: FastAPI, dist: Path | None = None) -> bool:
    """Attach static-file and SPA-fallback routes. Returns whether it mounted.

    Call this last: the fallback matches any unclaimed path, so every API route
    must already be registered or it would shadow them.
    """
    dist = dist or frontend_dist()
    if dist is None:
        return False

    index_html = dist / "index.html"

    assets = dist / "assets"
    if assets.is_dir():
        # Hashed filenames make these safe to cache indefinitely.
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def serve_spa(path: str) -> FileResponse:
        if path.startswith(_API_PREFIXES):
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Not found"})

        # Serve a real file when one exists (favicon.ico, robots.txt), otherwise
        # hand back the shell so client-side routing can take over on deep links
        # such as /room/<id>.
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
            return FileResponse(candidate)
        return FileResponse(index_html, headers={"Cache-Control": "no-cache"})

    return True
