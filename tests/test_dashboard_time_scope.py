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
async def dashboard_client(tmp_path):
    database_path = tmp_path / "dashboard-time-scope.db"
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


def build_log(*, observed_at: datetime, source_ip: str, destination_ip: str, destination_port: int, suffix: str) -> dict:
    return {
        "id": f"scope-{suffix}",
        "observed_at": observed_at,
        "raw_message": f"raw-{suffix}",
        "source_ip": source_ip,
        "source_port": 51000,
        "destination_ip": destination_ip,
        "destination_port": destination_port,
        "action": "block",
        "event_outcome": "blocked",
        "protocol": "tcp",
        "summary": f"{source_ip} -> {destination_ip}:{destination_port}",
        "traffic_flow": "external_to_internal",
        "source_country": "IT",
        "source_city": "Rome",
        "source_lat": 41.9028,
        "source_lon": 12.4964,
        "source_is_internal": False,
        "destination_is_internal": True,
        "enrichment_status": "done",
    }


@pytest.mark.asyncio
async def test_top_stats_respect_explicit_time_scope(dashboard_client):
    client, session_factory = dashboard_client
    now = datetime.now(UTC)

    await insert_logs(
        session_factory,
        [
            build_log(
                observed_at=now - timedelta(hours=6),
                source_ip="203.0.113.10",
                destination_ip="10.0.0.10",
                destination_port=22,
                suffix="old-source",
            ),
            build_log(
                observed_at=now - timedelta(minutes=5),
                source_ip="198.51.100.20",
                destination_ip="10.0.0.20",
                destination_port=443,
                suffix="recent-source",
            ),
        ],
    )

    response = await client.get(
        "/api/dashboard/top",
        params={
            "field": "source_ip",
            "minutes": 10140,
            "start_time": (now - timedelta(minutes=10)).isoformat(),
            "end_time": now.isoformat(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"] == [{"value": "198.51.100.20", "count": 1}]


@pytest.mark.asyncio
async def test_ip_detail_respects_explicit_time_scope(dashboard_client):
    client, session_factory = dashboard_client
    now = datetime.now(UTC)
    tracked_ip = "198.51.100.77"

    await insert_logs(
        session_factory,
        [
            build_log(
                observed_at=now - timedelta(hours=3),
                source_ip=tracked_ip,
                destination_ip="10.0.0.31",
                destination_port=25,
                suffix="old-ip-detail",
            ),
            build_log(
                observed_at=now - timedelta(minutes=2),
                source_ip=tracked_ip,
                destination_ip="10.0.0.32",
                destination_port=587,
                suffix="recent-ip-detail",
            ),
        ],
    )

    response = await client.get(
        "/api/dashboard/ip-detail",
        params={
            "ip": tracked_ip,
            "minutes": 10140,
            "start_time": (now - timedelta(minutes=15)).isoformat(),
            "end_time": now.isoformat(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_seen"] == 1
    assert payload["top_ports"] == [{"value": 587, "count": 1}]
    assert payload["top_destinations"] == [{"value": "10.0.0.32", "count": 1}]
