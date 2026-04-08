from typing import Protocol


class EnrichmentWorker(Protocol):
    async def submit(self, ip_value: str | None) -> None: ...


async def submit_external_ips(external_source_ips: set[str], enrichment_worker: EnrichmentWorker) -> None:
    for ip_value in external_source_ips:
        await enrichment_worker.submit(ip_value)
