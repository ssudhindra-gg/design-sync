from fastapi import APIRouter, Depends, Path, Response

from ..auth import (
    bad_request_error,
    get_current_account,
    get_store_dependency,
    not_found_error,
    optional_session_principal,
    require_interviewer,
)
from ..auth import SessionPrincipal
from ..models import CreateSessionRequest, CreateSessionResponse, Session, SessionEvent, SessionState, UpdateSessionRequest
from ..store import InMemoryStore

router = APIRouter(tags=["Sessions"])


@router.post("/sessions", response_model=CreateSessionResponse, status_code=201, operation_id="createSession")
async def create_session(
    payload: CreateSessionRequest,
    response: Response,
    _account=Depends(get_current_account),
    store: InMemoryStore = Depends(get_store_dependency),
) -> CreateSessionResponse:
    state, participant, token = store.create_session(payload.title, payload.hostName)
    response.set_cookie("ParticipantSession", token, httponly=True, secure=False, samesite="lax")
    await store.publish(SessionEvent(type="state", sessionId=state.session.id, origin=participant.id))
    return CreateSessionResponse(session=state.session, participant=participant)


@router.get("/sessions/{sessionId}", response_model=SessionState, operation_id="getSession")
def get_session(
    sessionId: str = Path(...),
    principal: SessionPrincipal | None = Depends(optional_session_principal),
    store: InMemoryStore = Depends(get_store_dependency),
) -> SessionState:
    state = store.get_state(sessionId) if principal and principal.session_id == sessionId else store.public_state(sessionId)
    if state is None:
        raise not_found_error("Session not found")
    if principal and principal.session_id == sessionId:
        participant = store.find_participant(sessionId, principal.participant_id)
        if participant is None or participant.role.value != "interviewer":
            state.notes.privateNotes = ""
    return state


@router.patch("/sessions/{sessionId}", response_model=Session, operation_id="updateSession")
async def update_session(
    payload: UpdateSessionRequest,
    sessionId: str = Path(...),
    _principal=Depends(require_interviewer),
    store: InMemoryStore = Depends(get_store_dependency),
) -> Session:
    patch = payload.model_dump(exclude_unset=True)
    if not patch:
        raise bad_request_error("At least one session field is required")
    if "title" in patch:
        patch["title"] = patch["title"].strip() or "System design interview"
    try:
        session = store.update_session(sessionId, patch)
    except KeyError:
        raise not_found_error("Session not found")
    await store.publish(SessionEvent(type="state", sessionId=sessionId, origin="server"))
    return session
