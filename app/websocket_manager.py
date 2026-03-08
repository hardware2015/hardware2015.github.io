from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections[user_id].add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        connections = self.active_connections.get(user_id)
        if not connections:
            return
        connections.discard(websocket)
        if not connections:
            self.active_connections.pop(user_id, None)

    async def broadcast(self, payload: dict) -> None:
        stale_connections: list[tuple[int, WebSocket]] = []
        for user_id, sockets in self.active_connections.items():
            for websocket in sockets:
                try:
                    await websocket.send_json(payload)
                except Exception:
                    stale_connections.append((user_id, websocket))

        for user_id, websocket in stale_connections:
            self.disconnect(user_id, websocket)


manager = ConnectionManager()
