import asyncio
from collections.abc import Iterable


from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import ConfigSubnet
from app.pipeline.inputs.syslog import SyslogProtocol
from app.pipeline.outputs.database import write_rows
from app.pipeline.outputs.enrichment import EnrichmentWorker, submit_external_ips
from app.pipeline.outputs.realtime import RealtimePublisher, publish_batch
from app.pipeline.processors.syslog import process_batch


class IngestionService:
    def __init__(
        self,
        enrichment_worker: EnrichmentWorker,
        realtime_hub: RealtimePublisher | None = None,
    ) -> None:
        self.settings = get_settings()
        self.enrichment_worker = enrichment_worker
        self.realtime_hub = realtime_hub
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
        rows, external_source_ips = process_batch(messages, subnets, self.settings.timezone)
        await write_rows(rows, SessionLocal)
        await submit_external_ips(external_source_ips, self.enrichment_worker)
        await publish_batch(rows, external_source_ips, self.realtime_hub)
