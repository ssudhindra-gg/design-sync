from fastapi import APIRouter, Depends, Path, WebSocket, WebSocketDisconnect

from ..auth import get_store_dependency
from ..store import InMemoryStore

router = APIRouter(tags=["Realtime"])


@router.websocket("/sessions/{sessionId}/events")
async def session_events(
    websocket: WebSocket,
    sessionId: str = Path(...),
    store: InMemoryStore = Depends(get_store_dependency),
) -> None:
    if store.get_state(sessionId) is None:
        await websocket.close(code=1008, reason="Session not found")
        return
    await websocket.accept()
    await store.connect(sessionId, websocket)
    try:
        while True:
            # The frontend only listens. Receiving text keeps the connection
            # open and allows clients to send harmless protocol pings.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await store.disconnect(sessionId, websocket)
