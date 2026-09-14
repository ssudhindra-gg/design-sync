from fastapi import APIRouter, Depends, Path

from ..auth import bad_request_error, get_store_dependency, not_found_error, permission_error, require_admitted_participant
from ..auth import SessionPrincipal
from ..models import ChatMessage, SendMessageRequest, SessionEvent
from ..store import InMemoryStore

router = APIRouter(tags=["Chat"])


@router.post("/sessions/{sessionId}/messages", response_model=ChatMessage, status_code=201, operation_id="sendMessage")
async def send_message(
    payload: SendMessageRequest,
    sessionId: str = Path(...),
    principal: SessionPrincipal = Depends(require_admitted_participant),
    store: InMemoryStore = Depends(get_store_dependency),
) -> ChatMessage:
    if payload.authorId != principal.participant_id:
        raise permission_error("The message author must be the authenticated participant")
    if not payload.body.strip():
        raise bad_request_error("Message body cannot be empty")
    participant = store.find_participant(sessionId, principal.participant_id)
    if participant is None:
        raise not_found_error("Participant not found")
    try:
        message = store.send_message(sessionId, principal.participant_id, participant.name, payload.body.strip())
    except KeyError:
        raise not_found_error("Session not found")
    await store.publish(SessionEvent(type="chat", sessionId=sessionId, origin=principal.participant_id))
    return message
