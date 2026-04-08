import asyncio
import json
import logging
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, Protocol

from app.models import FirewallLog

logger = logging.getLogger(__name__)
REALTIME_LATEST_LOGS_COUNT = 25
MAX_REALTIME_PAYLOAD_BYTES = 256 * 1024
REALTIME_TOPICS = {"dashboard", "logs", "timeline", "map", "graph", "alerts"}


class RealtimePublisher(Protocol):
    async def publish(self, payload: dict[str, Any], topics: set[str] | None = None) -> None: ...


def serialize_realtime_log(row: FirewallLog) -> dict:
    return {
        "id": row.id,
        "observed_at": row.observed_at.isoformat() if row.observed_at else None,
        "ingested_at": row.ingested_at.isoformat() if row.ingested_at else None,
        "summary": row.summary,
        "action": row.action,
        "event_outcome": row.event_outcome,
        "protocol": row.protocol,
        "source_ip": row.source_ip,
        "source_port": row.source_port,
        "destination_ip": row.destination_ip,
        "destination_port": row.destination_port,
        "traffic_flow": row.traffic_flow,
        "network_direction": row.network_direction,
        "source_country": row.source_country,
        "source_city": row.source_city,
        "source_lat": row.source_lat,
        "source_lon": row.source_lon,
        "raw_message": (row.raw_message or "")[:500],
    }


async def publish_batch(
    rows: Sequence[FirewallLog],
    external_source_ips: set[str],
    realtime_hub: RealtimePublisher | None,
) -> None:
    if not rows or realtime_hub is None:
        return

    action_breakdown: dict[str, int] = {}
    flow_breakdown: dict[str, int] = {}
    for row in rows:
        action_key = row.action or "unknown"
        flow_key = row.traffic_flow or "unknown"
        action_breakdown[action_key] = action_breakdown.get(action_key, 0) + 1
        flow_breakdown[flow_key] = flow_breakdown.get(flow_key, 0) + 1

    latest_logs: list[dict[str, Any]] = []
    payload_size = 0
    for row in rows[-REALTIME_LATEST_LOGS_COUNT:]:
        serialized = serialize_realtime_log(row)
        row_size = len(json.dumps(serialized).encode("utf-8"))
        if latest_logs and payload_size + row_size > MAX_REALTIME_PAYLOAD_BYTES:
            break
        latest_logs.append(serialized)
        payload_size += row_size

    payload = {
        "type": "ingestion_batch",
        "count": len(rows),
        "timestamp": datetime.now(UTC).isoformat(),
        "external_sources": sorted(external_source_ips),
        "action_breakdown": action_breakdown,
        "flow_breakdown": flow_breakdown,
        "latest_logs": latest_logs,
    }
    try:
        await realtime_hub.publish(payload, REALTIME_TOPICS)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Failed to publish realtime ingestion batch")
