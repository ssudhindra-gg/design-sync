from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Cookie, Depends, HTTPException, Path, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .models import Participant, Role

if TYPE_CHECKING:
    from .store import InMemoryStore


account_bearer = HTTPBearer(scheme_name="bearerAuth", auto_error=False)
session_bearer = HTTPBearer(scheme_name="sessionAuth", auto_error=False)


@dataclass(frozen=True)
class AccountRecord:
    username: str
    password_hash: str


@dataclass(frozen=True)
class SessionPrincipal:
    session_id: str
    participant_id: str


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str) -> str:
    """Hash a password with the stdlib scrypt KDF and a random salt."""

    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt$16384$8$1${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$", 5)
        if algorithm != "scrypt":
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=_unb64(salt),
            n=int(n),
            r=int(r),
            p=int(p),
        )
        return hmac.compare_digest(actual, _unb64(expected))
    except (TypeError, ValueError, UnicodeDecodeError):
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def auth_error(message: str = "Authentication required") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "unauthorized", "message": message})


def permission_error(message: str = "You do not have permission for this operation") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "forbidden", "message": message})


def not_found_error(message: str = "Resource not found") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "not_found", "message": message})


def bad_request_error(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "bad_request", "message": message})


def _get_store() -> InMemoryStore:
    # Imported lazily to keep auth and store modules independent during startup.
    from .store import get_store

    return get_store()


def get_store_dependency() -> InMemoryStore:
    return _get_store()


def get_current_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(account_bearer),
    store: InMemoryStore = Depends(get_store_dependency),
) -> AccountRecord:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise auth_error()
    username = store.account_for_token(credentials.credentials)
    if username is None:
        raise auth_error("Invalid bearer token")
    return store.accounts[username]


def optional_session_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(session_bearer),
    participant_cookie: str | None = Cookie(default=None, alias="ParticipantSession"),
    store: InMemoryStore = Depends(get_store_dependency),
) -> SessionPrincipal | None:
    token = credentials.credentials if credentials and credentials.scheme.lower() == "bearer" else participant_cookie
    if not token:
        return None
    return store.principal_for_token(token)


def require_session_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(session_bearer),
    participant_cookie: str | None = Cookie(default=None, alias="ParticipantSession"),
    store: InMemoryStore = Depends(get_store_dependency),
) -> SessionPrincipal:
    principal = optional_session_principal(credentials, participant_cookie, store)
    if principal is None:
        raise auth_error()
    return principal


def require_admitted_participant(
    sessionId: str = Path(...),
    principal: SessionPrincipal = Depends(require_session_principal),
    store: InMemoryStore = Depends(get_store_dependency),
) -> SessionPrincipal:
    if principal.session_id != sessionId:
        raise permission_error("This credential belongs to another session")
    participant = store.find_participant(sessionId, principal.participant_id)
    if participant is None:
        raise not_found_error("Participant not found")
    if participant.status.value != "admitted":
        raise permission_error("Participant has not been admitted")
    return principal


def require_interviewer(
    sessionId: str = Path(...),
    principal: SessionPrincipal = Depends(require_session_principal),
    store: InMemoryStore = Depends(get_store_dependency),
) -> SessionPrincipal:
    principal = require_admitted_participant(sessionId, principal, store)
    participant = store.find_participant(sessionId, principal.participant_id)
    if participant is None or participant.role is not Role.interviewer:
        raise permission_error("Interviewer role required")
    return principal


def require_self(
    participantId: str = Path(...),
    principal: SessionPrincipal = Depends(require_admitted_participant),
) -> SessionPrincipal:
    if principal.participant_id != participantId:
        raise permission_error("A participant may update only their own presence")
    return principal
