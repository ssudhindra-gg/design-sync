from fastapi import APIRouter, Depends, Path

from ..auth import get_store_dependency, not_found_error, permission_error, require_admitted_participant
from ..auth import SessionPrincipal
from ..models import CreateSnapshotRequest, Diagram, SessionEvent, Snapshot
from ..store import InMemoryStore

router = APIRouter(tags=["Snapshots"])


def _editable(store: InMemoryStore, sessionId: str, principal: SessionPrincipal) -> bool:
    state = store.get_state(sessionId)
    if state is None:
        raise not_found_error("Session not found")
    participant = store.find_participant(sessionId, principal.participant_id)
    return not state.session.ended and participant is not None and (
        participant.role.value == "interviewer" or not state.session.editingPaused
    )


@router.post("/sessions/{sessionId}/snapshots", response_model=list[Snapshot], status_code=201, operation_id="createSnapshot")
async def create_snapshot(
    payload: CreateSnapshotRequest,
    sessionId: str = Path(...),
    principal: SessionPrincipal = Depends(require_admitted_participant),
    store: InMemoryStore = Depends(get_store_dependency),
) -> list[Snapshot]:
    try:
        snapshots = store.create_snapshot(sessionId, payload.name)
    except KeyError:
        raise not_found_error("Session not found")
    await store.publish(SessionEvent(type="state", sessionId=sessionId, origin=principal.participant_id))
    return snapshots


@router.post("/sessions/{sessionId}/snapshots/{snapshotId}/restore", response_model=Diagram, operation_id="restoreSnapshot")
async def restore_snapshot(
    sessionId: str = Path(...),
    snapshotId: str = Path(...),
    principal: SessionPrincipal = Depends(require_admitted_participant),
    store: InMemoryStore = Depends(get_store_dependency),
) -> Diagram:
    if not _editable(store, sessionId, principal):
        raise permission_error("The diagram is read-only")
    try:
        diagram = store.restore_snapshot(sessionId, snapshotId)
    except KeyError as exc:
        if str(exc).strip("'") == sessionId:
            raise not_found_error("Session not found")
        raise not_found_error("Snapshot not found")
    await store.publish(SessionEvent(type="diagram", sessionId=sessionId, origin=principal.participant_id))
    return diagram


@router.delete("/sessions/{sessionId}/snapshots/{snapshotId}", response_model=list[Snapshot], operation_id="deleteSnapshot")
async def delete_snapshot(
    sessionId: str = Path(...),
    snapshotId: str = Path(...),
    principal: SessionPrincipal = Depends(require_admitted_participant),
    store: InMemoryStore = Depends(get_store_dependency),
) -> list[Snapshot]:
    try:
        snapshots = store.delete_snapshot(sessionId, snapshotId)
    except KeyError as exc:
        if str(exc).strip("'") == sessionId:
            raise not_found_error("Session not found")
        raise not_found_error("Snapshot not found")
    await store.publish(SessionEvent(type="state", sessionId=sessionId, origin=principal.participant_id))
    return snapshots
