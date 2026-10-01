"""Database-aware health check for container healthchecks and deploy validation."""

import os

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from ..auth import get_store_dependency
from ..store import InMemoryStore

router = APIRouter(tags=["Health"])


@router.get("/health", operation_id="getHealth")
def health(store: InMemoryStore = Depends(get_store_dependency)) -> JSONResponse:
    # The version lets a deploy prove the new code is the one answering.
    version = os.getenv("APP_VERSION", "dev")
    try:
        store.ping()
    except SQLAlchemyError:
        # Driver errors can carry connection details; report the state only.
        return JSONResponse(
            status_code=503,
            content={"status": "error", "database": "unavailable", "version": version},
        )
    return JSONResponse({"status": "ok", "database": "ok", "version": version})
