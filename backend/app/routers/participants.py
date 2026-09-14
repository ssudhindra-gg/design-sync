from fastapi import APIRouter, Depends, Path, Response

from ..auth import (
    bad_request_error,
    get_store_dependency,
    not_found_error,
    permission_error,
    require_interviewer,
    require_self,
)
from ..auth import SessionPrincipal
from ..models import (
    JoinSessionRequest,
    Participant,
    ParticipantStatus,
    SessionEvent,
    SetParticipantStatusRequest,
    UpdatePresenceRequest,
)
from ..store import InMemoryStore

router = APIRouter(tags=["Participants"])


@router.post("/sessions/{sessionId}/participants", response_model=Participant, status_code=201, operation_id="joinSession")
async def join_session(
    payload: JoinSessionRequest,
    response: Response,
    sessionId: str = Path(...),
    store: InMemoryStore = Depends(get_store_dependency),
) -> Participant:
    if payload.role.value != "guest":
        raise permission_error("Only guests may join through the public join endpoint")
    if not payload.name.strip():
        raise bad_request_error("A display name is required")
    try:
        participant, token = store.join_session(sessionId, payload.name, payload.role)
    except KeyError:
        raise not_found_error("Session not found")
    response.set_cookie("ParticipantSession", token, httponly=True, secure=False, samesite="lax")
    await store.publish(SessionEvent(type="presence", sessionId=sessionId, origin=participant.id))
    return participant


@router.patch("/sessions/{sessionId}/participants/{participantId}/status", response_model=list[Participant], operation_id="setParticipantStatus")
async def set_participant_status(
    payload: SetParticipantStatusRequest,
    sessionId: str = Path(...),
    participantId: str = Path(...),
    _principal: SessionPrincipal = Depends(require_interviewer),
    store: InMemoryStore = Depends(get_store_dependency),
) -> list[Participant]:
    try:
        participants = store.set_participant_status(sessionId, participantId, payload.status)
    except KeyError as exc:
        if str(exc).strip("'") == sessionId:
            raise not_found_error("Session not found")
        raise not_found_error("Participant not found")
    await store.publish(SessionEvent(type="presence", sessionId=sessionId, origin=_principal.participant_id))
    return participants


@router.patch("/sessions/{sessionId}/participants/{participantId}/presence", response_model=list[Participant], operation_id="updatePresence")
async def update_presence(
    payload: UpdatePresenceRequest,
    sessionId: str = Path(...),
    participantId: str = Path(...),
    principal: SessionPrincipal = Depends(require_self),
    store: InMemoryStore = Depends(get_store_dependency),
) -> list[Participant]:
    patch = payload.model_dump(exclude_unset=True)
    if not patch:
        raise bad_request_error("At least one presence field is required")
    if "name" in patch and not patch["name"].strip():
        raise bad_request_error("A participant name cannot be empty")
    try:
        participants = store.update_presence(sessionId, participantId, patch)
    except KeyError:
        raise not_found_error("Participant not found")
    await store.publish(SessionEvent(type="presence", sessionId=sessionId, origin=principal.participant_id))
    return participants
