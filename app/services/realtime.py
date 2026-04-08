from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

logger = logging.getLogger(__name__)
ALLOWED_REALTIME_TOPICS = {"dashboard", "logs", "timeline", "map", "graph", "alerts"}


class RealtimeSocket(Protocol):
    async def accept(self) -> None: ...

    async def send_json(self, payload: dict[str, Any]) -> None: ...

DEFAULT_REALTIME_TOPICS = {"dashboard"}
MAX_REALTIME_CONNECTIONS = 64


@dataclass
class RealtimeConnection:
    websocket: RealtimeSocket
    topics: set[str] = field(default_factory=lambda: set(DEFAULT_REALTIME_TOPICS))


class RealtimeHub:
    def __init__(self) -> None:
        self._connections: dict[int, RealtimeConnection] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def normalize_topics(
        topics: set[str] | list[str] | tuple[str, ...] | None,
        *,
        fallback_to_default: bool = True,
    ) -> set[str]:
        normalized = {
            str(topic).strip().lower()
            for topic in (topics or [])
            if str(topic).strip()
        }.intersection(ALLOWED_REALTIME_TOPICS)
        if normalized:
            return normalized
        return set(DEFAULT_REALTIME_TOPICS) if fallback_to_default else set()

    async def connect(self, websocket: RealtimeSocket, topics: set[str] | list[str] | None = None) -> set[str]:
        normalized_topics = self.normalize_topics(topics)
        async with self._lock:
            if len(self._connections) >= MAX_REALTIME_CONNECTIONS:
                raise RuntimeError("Maximum realtime connections reached")
        await websocket.accept()
        async with self._lock:
            self._connections[id(websocket)] = RealtimeConnection(websocket=websocket, topics=normalized_topics)
        return normalized_topics

    async def disconnect(self, websocket: RealtimeSocket) -> None:
        async with self._lock:
            self._connections.pop(id(websocket), None)

    async def update_topics(self, websocket: RealtimeSocket, topics: set[str] | list[str] | None = None) -> set[str]:
        normalized_topics = self.normalize_topics(topics)
        async with self._lock:
            connection = self._connections.get(id(websocket))
            if connection is None:
                self._connections[id(websocket)] = RealtimeConnection(websocket=websocket, topics=normalized_topics)
            else:
                connection.topics = normalized_topics
        return normalized_topics

    async def publish(self, payload: dict[str, Any], topics: set[str] | list[str] | None = None) -> None:
        normalized_topics = self.normalize_topics(topics, fallback_to_default=False)
        async with self._lock:
            snapshot = list(self._connections.items())

        stale_connections: list[int] = []
        for connection_id, connection in snapshot:
            if normalized_topics and not connection.topics.intersection(normalized_topics):
                continue
            try:
                await connection.websocket.send_json(payload)
            except Exception as exc:
                logger.debug("Removing stale websocket connection %s: %s", connection_id, exc)
                stale_connections.append(connection_id)

        if stale_connections:
            async with self._lock:
                for connection_id in stale_connections:
                    self._connections.pop(connection_id, None)

    @property
    def connection_count(self) -> int:
        return len(self._connections)
