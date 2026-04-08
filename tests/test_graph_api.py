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
async def graph_client(tmp_path):
    database_path = tmp_path / "graph-test.db"
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


def build_log(
    *,
    observed_at: datetime,
    source_ip: str | None,
    source_port: int | None,
    destination_ip: str | None,
    destination_port: int | None,
    suffix: str,
) -> dict:
    return {
        "id": f"log-{suffix}",
        "observed_at": observed_at,
        "raw_message": f"test-{suffix}",
        "source_ip": source_ip,
        "source_port": source_port,
        "destination_ip": destination_ip,
        "destination_port": destination_port,
        "action": "pass",
        "event_outcome": "allowed",
        "protocol": "tcp",
        "summary": f"{source_ip}:{source_port} -> {destination_ip}:{destination_port}",
        "source_is_internal": True,
        "destination_is_internal": False,
        "enrichment_status": "pending",
    }


@pytest.mark.asyncio
async def test_graph_endpoint_returns_multi_stage_topology(graph_client):
    client, session_factory = graph_client
    now = datetime.now(UTC)
    await insert_logs(
        session_factory,
        [
            build_log(
                observed_at=now - timedelta(minutes=5),
                source_ip="10.0.0.10",
                source_port=51000,
                destination_ip="192.168.1.50",
                destination_port=443,
                suffix="a1",
            ),
            build_log(
                observed_at=now - timedelta(minutes=4),
                source_ip="10.0.0.10",
                source_port=51000,
                destination_ip="192.168.1.50",
                destination_port=443,
                suffix="a2",
            ),
            build_log(
                observed_at=now - timedelta(minutes=3),
                source_ip="10.0.0.11",
                source_port=52000,
                destination_ip="192.168.1.50",
                destination_port=8443,
                suffix="b1",
            ),
        ],
    )

    response = await client.get("/api/dashboard/graph", params={"minutes": 60, "limit": 20})

    assert response.status_code == 200
    payload = response.json()
    assert payload["directed"] is True
    assert {node["category"] for node in payload["nodes"]} == {"source", "destination", "service"}

    nodes_by_id = {node["id"]: node for node in payload["nodes"]}
    assert nodes_by_id["10.0.0.10"]["category"] == "source"
    assert nodes_by_id["10.0.0.11"]["category"] == "source"
    assert nodes_by_id["192.168.1.50"]["category"] == "destination"
    assert nodes_by_id["10.0.0.10:51000"]["kind"] == "source_socket"
    assert nodes_by_id["10.0.0.11:52000"]["kind"] == "source_socket"
    assert nodes_by_id["192.168.1.50:443"]["kind"] == "destination_socket"
    assert nodes_by_id["192.168.1.50:8443"]["kind"] == "destination_socket"

    assert {
        (edge["source"], edge["target"], edge["value"], edge["label"])
        for edge in payload["edges"]
    } == {
        ("10.0.0.10", "10.0.0.10:51000", 2, "10.0.0.10 -> 10.0.0.10:51000"),
        ("10.0.0.10:51000", "192.168.1.50:443", 2, "10.0.0.10:51000 -> 192.168.1.50:443"),
        ("192.168.1.50:443", "192.168.1.50", 2, "192.168.1.50:443 -> 192.168.1.50"),
        ("10.0.0.11", "10.0.0.11:52000", 1, "10.0.0.11 -> 10.0.0.11:52000"),
        ("10.0.0.11:52000", "192.168.1.50:8443", 1, "10.0.0.11:52000 -> 192.168.1.50:8443"),
        ("192.168.1.50:8443", "192.168.1.50", 1, "192.168.1.50:8443 -> 192.168.1.50"),
    }


@pytest.mark.asyncio
async def test_graph_endpoint_keeps_bidirectional_flows_distinct(graph_client):
    client, session_factory = graph_client
    now = datetime.now(UTC)
    await insert_logs(
        session_factory,
        [
            build_log(
                observed_at=now - timedelta(minutes=2),
                source_ip="10.0.0.20",
                source_port=53000,
                destination_ip="192.168.1.60",
                destination_port=22,
                suffix="c1",
            ),
            build_log(
                observed_at=now - timedelta(minutes=1),
                source_ip="192.168.1.60",
                source_port=22,
                destination_ip="10.0.0.20",
                destination_port=53000,
                suffix="c2",
            ),
            build_log(
                observed_at=now - timedelta(minutes=1),
                source_ip="10.0.0.20",
                source_port=None,
                destination_ip="192.168.1.60",
                destination_port=22,
                suffix="ignored-null-port",
            ),
        ],
    )

    response = await client.get("/api/dashboard/graph", params={"minutes": 60, "limit": 20})

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["edges"]) == 6
    assert {
        (edge["source"], edge["target"], edge["value"])
        for edge in payload["edges"]
    } == {
        ("10.0.0.20", "10.0.0.20:53000", 1),
        ("10.0.0.20:53000", "192.168.1.60:22", 1),
        ("192.168.1.60:22", "192.168.1.60", 1),
        ("192.168.1.60", "192.168.1.60:22", 1),
        ("192.168.1.60:22", "10.0.0.20:53000", 1),
        ("10.0.0.20:53000", "10.0.0.20", 1),
    }
    assert all("ignored-null-port" not in edge["label"] for edge in payload["edges"])