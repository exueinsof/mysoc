from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.routes import router
from app.db.base import Base
from app.db.session import get_session
from app.models import FirewallLog


@pytest_asyncio.fixture
async def timeline_client(tmp_path):
    database_path = tmp_path / "timeline-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    app = FastAPI()
    app.include_router(router)

    async def override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        yield client, session_factory

    await engine.dispose()


async def insert_logs(session_factory, rows: list[dict]) -> None:
    async with session_factory() as session:
        for row in rows:
            session.add(FirewallLog(**row))
            await session.flush()
        await session.commit()


def build_log(*, observed_at: datetime, source_ip: str, destination_ip: str, destination_port: int, action: str, flow: str, suffix: str) -> dict:
    return {
        "id": f"timeline-{suffix}",
        "observed_at": observed_at,
        "raw_message": f"raw-{suffix}",
        "source_ip": source_ip,
        "source_port": 51000,
        "destination_ip": destination_ip,
        "destination_port": destination_port,
        "action": action,
        "event_outcome": "blocked" if action == "block" else "allowed",
        "protocol": "tcp",
        "summary": f"{source_ip} -> {destination_ip}:{destination_port}",
        "traffic_flow": flow,
        "source_is_internal": source_ip.startswith("10."),
        "destination_is_internal": destination_ip.startswith("10."),
        "enrichment_status": "pending",
    }


@pytest.mark.asyncio
async def test_timeline_overview_preserves_legacy_rows_and_bounds(timeline_client):
    client, session_factory = timeline_client
    now = datetime.now(UTC)

    await insert_logs(
        session_factory,
        [
            build_log(
                observed_at=now - timedelta(minutes=25),
                source_ip="10.0.0.10",
                destination_ip="192.168.1.50",
                destination_port=443,
                action="block",
                flow="internal_to_external",
                suffix="a",
            ),
            build_log(
                observed_at=now - timedelta(minutes=10),
                source_ip="10.0.0.10",
                destination_ip="192.168.1.60",
                destination_port=8443,
                action="pass",
                flow="internal_to_external",
                suffix="b",
            ),
            build_log(
                observed_at=now - timedelta(minutes=5),
                source_ip="8.8.8.8",
                destination_ip="10.0.0.20",
                destination_port=22,
                action="block",
                flow="external_to_internal",
                suffix="c",
            ),
        ],
    )

    response = await client.post(
        "/api/dashboard/timeline/overview",
        json={
            "minutes": 60,
            "tracks": ["event", "traffic_flow", "source_ip", "action"],
            "collapsed_groups": ["source_ip"],
            "max_rows_per_group": 4,
        },
    )

    assert response.status_code == 200
    payload = response.json()

    assert payload["requested_start"]
    assert payload["requested_end"]
    assert payload["absolute_min_time"]
    assert payload["absolute_max_time"]
    assert payload["bucket_seconds"] >= 1
    assert payload["buffer_cap"] >= 1

    rows = payload["rows"]
    row_ids = {row["id"] for row in rows}
    assert "event::group" in row_ids
    assert "source_ip::group" in row_ids
    assert any(row["track_key"] == "traffic_flow" and row["aggregated"] is False for row in rows)
    assert any(row["track_key"] == "action" and row["aggregated"] is False for row in rows)

    points = payload["points"]
    assert points
    assert {point["track_key"] for point in points}.issubset({"event", "traffic_flow", "source_ip", "action"})


@pytest.mark.asyncio
async def test_timeline_detail_returns_real_events_for_small_window(timeline_client):
    client, session_factory = timeline_client
    now = datetime.now(UTC)
    start = now - timedelta(minutes=15)
    end = now - timedelta(minutes=1)

    await insert_logs(
        session_factory,
        [
            build_log(
                observed_at=start,
                source_ip="10.0.0.30",
                destination_ip="192.168.1.70",
                destination_port=53,
                action="pass",
                flow="internal_to_external",
                suffix="d",
            ),
            build_log(
                observed_at=start + timedelta(minutes=7),
                source_ip="8.8.4.4",
                destination_ip="10.0.0.30",
                destination_port=443,
                action="block",
                flow="external_to_internal",
                suffix="e",
            ),
        ],
    )

    response = await client.post(
        "/api/dashboard/timeline/detail",
        json={
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "rows": [
                {"id": "event::group", "track_key": "event", "label": "Eventi generali", "aggregated": True},
                {"id": "action::group", "track_key": "action", "label": "Action", "aggregated": True},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "events"
    assert payload["truncated"] is False
    assert payload["events_total"] == 2
    assert len(payload["events"]) == 2
    assert payload["events"][0]["time"] <= payload["events"][1]["time"]
    assert payload["events"][0]["summary"] == "10.0.0.30 -> 192.168.1.70:53"
    assert payload["events"][1]["action"] == "block"
