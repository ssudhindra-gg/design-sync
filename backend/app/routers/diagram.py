from fastapi import APIRouter, Depends, Path

from ..auth import bad_request_error, get_store_dependency, not_found_error, permission_error, require_admitted_participant, require_interviewer
from ..auth import SessionPrincipal
from ..models import Diagram, SessionEvent, SetNodeLockRequest
from ..store import InMemoryStore

router = APIRouter(tags=["Diagram"])


def _can_edit(store: InMemoryStore, sessionId: str, principal: SessionPrincipal) -> bool:
    state = store.get_state(sessionId)
    if state is None:
        raise not_found_error("Session not found")
    if state.session.ended:
        return False
    participant = store.find_participant(sessionId, principal.participant_id)
    return participant is not None and (participant.role.value == "interviewer" or not state.session.editingPaused)


@router.put("/sessions/{sessionId}/diagram", response_model=Diagram, operation_id="saveDiagram")
async def save_diagram(
    diagram: Diagram,
    sessionId: str = Path(...),
    principal: SessionPrincipal = Depends(require_admitted_participant),
    store: InMemoryStore = Depends(get_store_dependency),
) -> Diagram:
    if not _can_edit(store, sessionId, principal):
        raise permission_error("The diagram is read-only")
    current = store.get_state(sessionId)
    if current is None:
        raise not_found_error("Session not found")
    participant = store.find_participant(sessionId, principal.participant_id)
    if participant is not None and participant.role.value != "interviewer":
        current_locked = {node.id: node for node in current.diagram.nodes if node.locked}
        incoming = {node.id: node for node in diagram.nodes}
        if any(node_id not in incoming or incoming[node_id] != old_node for node_id, old_node in current_locked.items()):
            raise permission_error("A locked node cannot be changed by a guest")
    try:
        saved = store.save_diagram(sessionId, diagram)
    except KeyError:
        raise not_found_error("Session not found")
    except ValueError as exc:
        raise bad_request_error(str(exc))
    await store.publish(SessionEvent(type="diagram", sessionId=sessionId, origin=principal.participant_id))
    return saved


@router.patch("/sessions/{sessionId}/diagram/nodes/{nodeId}/lock", response_model=Diagram, operation_id="setNodeLock")
async def set_node_lock(
    payload: SetNodeLockRequest,
    sessionId: str = Path(...),
    nodeId: str = Path(...),
    principal: SessionPrincipal = Depends(require_interviewer),
    store: InMemoryStore = Depends(get_store_dependency),
) -> Diagram:
    try:
        diagram = store.set_node_lock(sessionId, nodeId, payload.locked)
    except KeyError as exc:
        if str(exc).strip("'") == sessionId:
            raise not_found_error("Session not found")
        raise not_found_error("Node not found")
    await store.publish(SessionEvent(type="diagram", sessionId=sessionId, origin=principal.participant_id))
    return diagram
