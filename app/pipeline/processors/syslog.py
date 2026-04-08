from collections.abc import Iterable

from app.models import FirewallLog
from app.services.classifier import classify_flow
from app.services.parser import parse_syslog_message


def process_batch(raw_messages: Iterable[str], subnets: list[str], timezone_name: str) -> tuple[list[FirewallLog], set[str]]:
    rows: list[FirewallLog] = []
    external_source_ips: set[str] = set()

    for raw_message in raw_messages:
        parsed = parse_syslog_message(raw_message, timezone_name)
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

        source_ip = parsed.get("source_ip")
        if source_ip and not parsed["source_is_internal"]:
            external_source_ips.add(source_ip)

        rows.append(FirewallLog(**parsed))

    return rows, external_source_ips
