import asyncio
from collections.abc import Iterable

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import ConfigSubnet, FirewallLog
from app.services.classifier import classify_flow
from app.services.parser import parse_syslog_message


class SyslogProtocol(asyncio.DatagramProtocol):
    def __init__(self, queue: asyncio.Queue[str]) -> None:
        self.queue = queue

    def datagram_received(self, data: bytes, addr) -> None:
        try:
            message = data.decode("utf-8", errors="replace")
        except Exception:
            return
        self.queue.put_nowait(message)


class IngestionService:
    def __init__(self, enrichment_worker) -> None:
        self.settings = get_settings()
        self.enrichment_worker = enrichment_worker
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.transport = None
        self.protocol = None
        self.worker_task: asyncio.Task | None = None

    async def start(self) -> None:
        loop = asyncio.get_running_loop()
        self.transport, self.protocol = await loop.create_datagram_endpoint(
            lambda: SyslogProtocol(self.queue),
            local_addr=(self.settings.udp_host, self.settings.udp_port),
        )
        self.worker_task = asyncio.create_task(self._consume_loop(), name="syslog-ingestion")

    async def stop(self) -> None:
        if self.transport:
            self.transport.close()
        if self.worker_task:
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass

    async def _load_enabled_subnets(self) -> list[str]:
        async with SessionLocal() as session:
            result = await session.scalars(select(ConfigSubnet.cidr).where(ConfigSubnet.enabled.is_(True)))
            return list(result)

    async def _consume_loop(self) -> None:
        while True:
            batch = [await self.queue.get()]
            try:
                deadline = asyncio.get_running_loop().time() + self.settings.udp_flush_interval
                while len(batch) < self.settings.udp_batch_size:
                    timeout = deadline - asyncio.get_running_loop().time()
                    if timeout <= 0:
                        break
                    try:
                        batch.append(await asyncio.wait_for(self.queue.get(), timeout=timeout))
                    except asyncio.TimeoutError:
                        break
                await self._store_batch(batch)
            finally:
                for _ in batch:
                    self.queue.task_done()

    async def _store_batch(self, messages: Iterable[str]) -> None:
        subnets = await self._load_enabled_subnets()
        rows = []
        external_source_ips = set()
        for raw_message in messages:
            parsed = parse_syslog_message(raw_message, self.settings.timezone)
            if parsed.get("source_ip") or parsed.get("destination_ip"):
                parsed.update(classify_flow(parsed.get("source_ip"), parsed.get("destination_ip"), subnets))
            else:
                parsed.update(
                    {
                        "source_is_internal": False,
                        "destination_is_internal": False,
                        "network_direction": None,
                        "traffic_flow": None,
                    }
                )
            if parsed.get("source_ip") and not parsed["source_is_internal"]:
                external_source_ips.add(parsed["source_ip"])
            rows.append(FirewallLog(**parsed))

        async with SessionLocal() as session:
            session.add_all(rows)
            await session.commit()

        for ip_value in external_source_ips:
            await self.enrichment_worker.submit(ip_value)
