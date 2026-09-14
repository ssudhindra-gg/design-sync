from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import get_store_dependency
from .routers import auth, chat, diagram, notes, participants, realtime, sessions, snapshots
from .store import InMemoryStore


def _error_content(detail: object, default_code: str = "http_error") -> dict[str, object]:
    if isinstance(detail, dict) and "code" in detail and "message" in detail:
        return detail
    return {"code": default_code, "message": str(detail)}


def create_app(store: InMemoryStore | None = None) -> FastAPI:
    app = FastAPI(
        title="Whiteboard IV Interview API",
        version="1.0.0",
        description="In-memory FastAPI implementation of the Whiteboard IV frontend contract.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if store is not None:
        app.dependency_overrides[get_store_dependency] = lambda: store

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_content(exc.detail),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={
                "code": "bad_request",
                "message": "Request validation failed",
                "details": {"errors": exc.errors()},
            },
        )

    route_modules = [auth, sessions, participants, diagram, chat, notes, snapshots, realtime]
    for module in route_modules:
        app.include_router(module.router, prefix="/api")
        # A root alias makes the service convenient behind a reverse proxy that
        # already strips /api. It is intentionally omitted from generated docs.
        app.include_router(module.router, include_in_schema=False)
    return app


app = create_app()
