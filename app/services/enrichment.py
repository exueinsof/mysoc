import asyncio
import gzip
import re
from pathlib import Path

import httpx
import maxminddb
from sqlalchemy import delete, select, text, update

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import FirewallLog, GeoIPCache


class GeoEnrichmentWorker:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._reader = None

    async def start(self) -> None:
        db_path = Path(self.settings.mmdb_path)
        await self._ensure_database(db_path)
        if db_path.exists():
            self._reader = maxminddb.open_database(str(db_path))
        await self._reset_cached_enrichment()
        self._task = asyncio.create_task(self._run(), name="geoip-enrichment")
        await self._schedule_pending_ips()

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._reader:
            self._reader.close()

    async def submit(self, ip_value: str | None) -> None:
        if ip_value:
            await self.queue.put(ip_value)

    async def _run(self) -> None:
        while True:
            ip_value = await self.queue.get()
            try:
                await self._enrich_ip(ip_value)
            finally:
                self.queue.task_done()

    async def _ensure_database(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path = db_path.with_suffix(".url")
        if not self.settings.geoip_enable_download and db_path.exists():
            return

        current_download_url = await self._resolve_dbip_mmdb_url()
        if db_path.exists() and meta_path.exists() and meta_path.read_text().strip() == current_download_url:
            return

        if not self.settings.geoip_enable_download and not db_path.exists():
            return

        compressed_path = db_path.with_suffix(".mmdb.gz")
        temp_path = db_path.with_suffix(".tmp")
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
            response = await client.get(current_download_url, headers={"User-Agent": "mysoc/0.1.0"})
            response.raise_for_status()
            compressed_path.write_bytes(response.content)

        with gzip.open(compressed_path, "rb") as source:
            temp_path.write_bytes(source.read())

        compressed_path.unlink(missing_ok=True)
        temp_path.replace(db_path)
        meta_path.write_text(current_download_url)

    async def _resolve_dbip_mmdb_url(self) -> str:
        base_url = self.settings.geoip_download_url
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.get(base_url, headers={"User-Agent": "Mozilla/5.0"})
            response.raise_for_status()
        match = re.search(r"href='(https://download\.db-ip\.com/free/dbip-city-lite-[0-9]{4}-[0-9]{2}\.mmdb\.gz)'", response.text)
        if not match:
            raise RuntimeError("Unable to resolve DB-IP Lite MMDB download URL")
        return match.group(1)

    async def _schedule_pending_ips(self) -> None:
        async with SessionLocal() as session:
            stmt = (
                select(FirewallLog.source_ip)
                .where(FirewallLog.source_ip.is_not(None))
                .where((FirewallLog.enrichment_status != "done") | (FirewallLog.source_country.is_(None)))
                .distinct()
            )
            pending_ips = (await session.scalars(stmt)).all()
        for ip_value in pending_ips:
            await self.queue.put(ip_value)

    async def _reset_cached_enrichment(self) -> None:
        async with SessionLocal() as session:
            await session.execute(delete(GeoIPCache))
            await session.execute(
                update(FirewallLog)
                .where(FirewallLog.source_ip.is_not(None))
                .values(
                    source_country=None,
                    source_city=None,
                    source_lat=None,
                    source_lon=None,
                    enrichment_status="pending",
                )
            )
            await session.commit()

    async def _enrich_ip(self, ip_value: str) -> None:
        async with SessionLocal() as session:
            cached = await session.get(GeoIPCache, ip_value)
            if cached is not None:
                await self._apply_cache(session, ip_value, cached)
                return

            data = {"country": None, "city": None, "lat": None, "lon": None}
            if self._reader:
                try:
                    record = self._reader.get(ip_value) or {}
                    country_names = (record.get("country") or {}).get("names") or {}
                    city_names = (record.get("city") or {}).get("names") or {}
                    location = record.get("location") or {}
                    data = {
                        "country": country_names.get("en") or (record.get("country") or {}).get("iso_code"),
                        "city": city_names.get("en"),
                        "lat": location.get("latitude"),
                        "lon": location.get("longitude"),
                    }
                except Exception:
                    data = {"country": None, "city": None, "lat": None, "lon": None}

            cache_entry = GeoIPCache(ip=ip_value, **data)
            session.add(cache_entry)
            await session.flush()
            await self._apply_cache(session, ip_value, cache_entry)

    async def _apply_cache(self, session, ip_value: str, cache: GeoIPCache) -> None:
        await session.execute(
            update(FirewallLog)
            .where(FirewallLog.source_ip == ip_value)
            .values(
                source_country=cache.country,
                source_city=cache.city,
                source_lat=cache.lat,
                source_lon=cache.lon,
                enrichment_status="done",
            )
        )
        if self.settings.is_postgres and cache.lat is not None and cache.lon is not None:
            await session.execute(
                text(
                    """
                    UPDATE firewall_logs
                    SET source_geo = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
                    WHERE source_ip = :ip
                    """
                ),
                {"ip": ip_value, "lat": cache.lat, "lon": cache.lon},
            )
        await session.commit()
