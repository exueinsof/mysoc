from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models import FirewallLog


class DummyRealtimeHub:
    def __init__(self) -> None:
        self.calls: list[tuple[dict, set[str]]] = []

    async def publish(self, payload: dict, topics: set[str]) -> None:
        self.calls.append((payload, topics))


@pytest.mark.asyncio
async def test_process_batch_builds_rows_and_collects_external_ips(monkeypatch):
    from app.pipeline.processors.syslog import process_batch

    def fake_parse_syslog_message(raw_message: str, _timezone_name: str) -> dict:
        return {
            "id": f"log-{raw_message}",
            "observed_at": datetime.now(UTC),
            "raw_message": raw_message,
            "source_ip": "8.8.8.8",
            "source_port": 443,
            "destination_ip": "10.0.0.5",
            "destination_port": 8443,
            "action": "block",
            "event_outcome": "blocked",
            "protocol": "tcp",
            "summary": "8.8.8.8:443 -> 10.0.0.5:8443",
        }

    def fake_classify_flow(_source_ip: str | None, _destination_ip: str | None, _subnets: list[str]) -> dict:
        return {
            "source_is_internal": False,
            "destination_is_internal": True,
            "network_direction": "inbound",
            "traffic_flow": "external_to_internal",
        }

    monkeypatch.setattr("app.pipeline.processors.syslog.parse_syslog_message", fake_parse_syslog_message)
    monkeypatch.setattr("app.pipeline.processors.syslog.classify_flow", fake_classify_flow)

    rows, external_ips = process_batch(["m1", "m2"], ["10.0.0.0/8"], "Europe/Rome")

    assert len(rows) == 2
    assert all(isinstance(row, FirewallLog) for row in rows)
    assert rows[0].traffic_flow == "external_to_internal"
    assert rows[0].destination_is_internal is True
    assert external_ips == {"8.8.8.8"}


@pytest.mark.asyncio
async def test_db_writer_and_realtime_publisher_preserve_batch_contract(tmp_path):
    from app.pipeline.outputs.database import write_rows
    from app.pipeline.outputs.realtime import publish_batch

    database_path = tmp_path / "pipeline.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    rows = [
        FirewallLog(
            id="pipeline-a",
            observed_at=datetime.now(UTC),
            raw_message="msg-a",
            source_ip="8.8.8.8",
            source_port=443,
            destination_ip="10.0.0.5",
            destination_port=8443,
            action="block",
            event_outcome="blocked",
            protocol="tcp",
            summary="8.8.8.8:443 -> 10.0.0.5:8443",
            source_is_internal=False,
            destination_is_internal=True,
            network_direction="inbound",
            traffic_flow="external_to_internal",
            enrichment_status="pending",
        )
    ]

    await write_rows(rows, session_factory)

    async with session_factory() as session:
        stored_count = await session.scalar(select(func.count(FirewallLog.id)))

    realtime_hub = DummyRealtimeHub()
    await publish_batch(rows, {"8.8.8.8"}, realtime_hub)

    assert stored_count == 1
    assert len(realtime_hub.calls) == 1
    payload, topics = realtime_hub.calls[0]
    assert payload["type"] == "ingestion_batch"
    assert payload["count"] == 1
    assert payload["external_sources"] == ["8.8.8.8"]
    assert topics == {"dashboard", "logs", "timeline", "map", "graph", "alerts"}

    await engine.dispose()
