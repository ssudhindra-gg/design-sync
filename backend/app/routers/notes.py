from fastapi import APIRouter, Depends, Path

from ..auth import bad_request_error, get_store_dependency, not_found_error, permission_error, require_admitted_participant
from ..auth import SessionPrincipal
from ..models import Notes, SaveNotesRequest, SessionEvent
from ..store import InMemoryStore

router = APIRouter(tags=["Notes"])


@router.patch("/sessions/{sessionId}/notes", response_model=Notes, operation_id="saveNotes")
async def save_notes(
    payload: SaveNotesRequest,
    sessionId: str = Path(...),
    principal: SessionPrincipal = Depends(require_admitted_participant),
    store: InMemoryStore = Depends(get_store_dependency),
) -> Notes:
    patch = payload.model_dump(exclude_unset=True)
    if not patch:
        raise bad_request_error("At least one notes field is required")
    participant = store.find_participant(sessionId, principal.participant_id)
    if participant is None:
        raise not_found_error("Participant not found")
    state = store.get_state(sessionId)
    if state is None:
        raise not_found_error("Session not found")
    if participant.role.value != "interviewer" and "privateNotes" in patch:
        raise permission_error("Private notes are available only to the interviewer")
    if participant.role.value != "interviewer" and state.session.ended:
        raise permission_error("Ended sessions are read-only")
    try:
        notes = store.save_notes(sessionId, patch)
    except KeyError:
        raise not_found_error("Session not found")
    if participant.role.value != "interviewer":
        notes.privateNotes = ""
    await store.publish(SessionEvent(type="state", sessionId=sessionId, origin=principal.participant_id))
    return notes
