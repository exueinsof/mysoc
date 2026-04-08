from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.routes import router
from app.db.base import Base
from app.models import FirewallLog
from app.services.ingestion import IngestionService
from app.services.realtime import RealtimeHub


class DummyWebSocket:
    def __init__(self) -> None:
        self.accepted = False
        self.messages: list[dict] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, payload: dict) -> None:
        self.messages.append(payload)


class DummyEnrichmentWorker:
    def __init__(self) -> None:
        self.submitted: list[str] = []

    async def submit(self, ip_value: str) -> None:
        self.submitted.append(ip_value)


class StubRealtimeHub:
    def __init__(self) -> None:
        self.events: list[tuple[dict, set[str]]] = []

    async def publish(self, payload: dict, topics: set[str] | None = None) -> None:
        self.events.append((payload, topics or set()))


@pytest.mark.asyncio
async def test_realtime_hub_broadcasts_only_to_matching_topics():
    hub = RealtimeHub()
    dashboard_ws = DummyWebSocket()
    logs_ws = DummyWebSocket()
    alerts_ws = DummyWebSocket()

    await hub.connect(dashboard_ws, {"dashboard", "logs"})
    await hub.connect(logs_ws, {"logs"})
    await hub.connect(alerts_ws, {"alerts"})

    await hub.publish({"type": "ingestion_batch", "count": 2}, {"logs"})

    assert dashboard_ws.accepted is True
    assert logs_ws.accepted is True
    assert alerts_ws.accepted is True
    assert dashboard_ws.messages[-1]["type"] == "ingestion_batch"
    assert logs_ws.messages[-1]["type"] == "ingestion_batch"
    assert alerts_ws.messages == []


@pytest.mark.asyncio
async def test_store_batch_publishes_realtime_event(monkeypatch, tmp_path):
    database_path = tmp_path / "realtime.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def fake_load_enabled_subnets():
        return ["10.0.0.0/8"]

    def fake_parse_syslog_message(raw_message: str, _timezone: str) -> dict:
        return {
            "id": f"log-{raw_message}",
            "observed_at": datetime.now(UTC),
            "raw_message": raw_message,
            "source_ip": "8.8.8.8",
            "source_port": 443,
            "destination_ip": "10.0.0.10",
            "destination_port": 8443,
            "action": "block",
            "event_outcome": "blocked",
            "protocol": "tcp",
            "summary": "8.8.8.8:443 -> 10.0.0.10:8443",
        }

    def fake_classify_flow(_source_ip: str | None, _destination_ip: str | None, _subnets: list[str]) -> dict:
        return {
            "source_is_internal": False,
            "destination_is_internal": True,
            "network_direction": "external_to_internal",
            "traffic_flow": "external_to_internal",
        }

    monkeypatch.setattr("app.services.ingestion.SessionLocal", session_factory)
    monkeypatch.setattr("app.pipeline.processors.syslog.parse_syslog_message", fake_parse_syslog_message)
    monkeypatch.setattr("app.pipeline.processors.syslog.classify_flow", fake_classify_flow)

    enrichment_worker = DummyEnrichmentWorker()
    realtime_hub = StubRealtimeHub()
    service = IngestionService(enrichment_worker, realtime_hub=realtime_hub)
    monkeypatch.setattr(service, "_load_enabled_subnets", fake_load_enabled_subnets)

    await service._store_batch(["sample-message"])

    async with session_factory() as session:
        stored_count = await session.scalar(select(func.count(FirewallLog.id)))

    assert stored_count == 1
    assert enrichment_worker.submitted == ["8.8.8.8"]
    assert len(realtime_hub.events) == 1
    event, topics = realtime_hub.events[0]
    assert topics == {"dashboard", "logs", "timeline", "map", "graph", "alerts"}
    assert event["type"] == "ingestion_batch"
    assert event["count"] == 1
    assert event["latest_logs"][0]["source_ip"] == "8.8.8.8"

    await engine.dispose()


def test_live_websocket_endpoint_accepts_subscribe_and_ping():
    app = FastAPI()
    app.state.realtime = RealtimeHub()
    app.include_router(router)

    with TestClient(app) as client:
        with client.websocket_connect("/api/ws/live") as websocket:
            connected = websocket.receive_json()
            assert connected["type"] == "connected"
            assert connected["topics"] == ["dashboard"]

            websocket.send_json({"type": "subscribe", "topics": ["logs", "timeline"]})
            subscribed = websocket.receive_json()
            assert subscribed["type"] == "subscribed"
            assert set(subscribed["topics"]) == {"logs", "timeline"}

            websocket.send_json({"type": "ping"})
            pong = websocket.receive_json()
            assert pong["type"] == "pong"
