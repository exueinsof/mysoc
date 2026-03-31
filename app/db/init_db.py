import asyncio

from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models import AlertThreshold, ConfigSubnet, MetricCatalog, ScopeCatalog


async def init_db() -> None:
    settings = get_settings()
    for attempt in range(30):
        try:
            async with engine.begin() as conn:
                if settings.is_postgres:
                    await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
                    await conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb"))
                await conn.run_sync(Base.metadata.create_all)
                if settings.is_postgres:
                    await conn.execute(
                        text(
                            """
                            SELECT create_hypertable('firewall_logs', 'observed_at', if_not_exists => TRUE);
                            """
                        )
                    )
                    await conn.execute(
                        text(
                            """
                            ALTER TABLE firewall_logs
                            ADD COLUMN IF NOT EXISTS source_geo geography(POINT, 4326);
                            """
                        )
                    )
            break
        except OperationalError:
            if attempt == 29:
                raise
            await asyncio.sleep(2)

    async with SessionLocal() as session:
        existing_scopes = await session.scalar(select(ScopeCatalog.id).limit(1))
        if existing_scopes is None:
            session.add_all(
                [
                    ScopeCatalog(name="internal"),
                    ScopeCatalog(name="external"),
                    ScopeCatalog(name="dmz"),
                    ScopeCatalog(name="guest"),
                    ScopeCatalog(name="branch"),
                ]
            )

        existing_metrics = await session.scalar(select(MetricCatalog.id).limit(1))
        if existing_metrics is None:
            session.add_all(
                [
                    MetricCatalog(name="blocked_connections_per_source_ip"),
                    MetricCatalog(name="distinct_destination_ports_per_source_ip"),
                    MetricCatalog(name="events_per_destination_ip"),
                    MetricCatalog(name="connections_per_source_port"),
                ]
            )

        existing = await session.scalar(select(ConfigSubnet.id).limit(1))
        if existing is None:
            session.add_all(
                [
                    ConfigSubnet(name=f"default-{cidr}", cidr=cidr, scope="internal", enabled=True)
                    for cidr in settings.internal_subnets_default
                ]
            )
        existing_alert = await session.scalar(select(AlertThreshold.id).limit(1))
        if existing_alert is None:
            session.add_all(
                [
                    AlertThreshold(name="blocked_ip_burst", metric="blocked_connections_per_source_ip", threshold=50, window_seconds=60),
                    AlertThreshold(name="aggressive_port_scan", metric="distinct_destination_ports_per_source_ip", threshold=20, window_seconds=120),
                ]
            )
        await session.commit()
