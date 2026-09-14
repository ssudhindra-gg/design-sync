from fastapi import APIRouter, Depends

from ..auth import auth_error, get_store_dependency, verify_password
from ..models import LoginRequest, TokenResponse
from ..store import InMemoryStore

router = APIRouter(tags=["Auth"])


@router.post("/auth/login", response_model=TokenResponse, operation_id="login")
def login(payload: LoginRequest, store: InMemoryStore = Depends(get_store_dependency)) -> TokenResponse:
    account = store.accounts.get(payload.username)
    if account is None or not verify_password(payload.password, account.password_hash):
        raise auth_error("Invalid username or password")
    return TokenResponse(access_token=store.issue_account_token(account.username))
