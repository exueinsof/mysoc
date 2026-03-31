import ipaddress
from typing import Iterable


def is_internal(ip_value: str | None, subnets: Iterable[str]) -> bool:
    if not ip_value:
        return False
    try:
        ip_obj = ipaddress.ip_address(ip_value)
    except ValueError:
        return False
    for cidr in subnets:
        try:
            if ip_obj in ipaddress.ip_network(cidr, strict=False):
                return True
        except ValueError:
            continue
    return False


def classify_flow(source_ip: str | None, destination_ip: str | None, subnets: Iterable[str]) -> dict:
    source_internal = is_internal(source_ip, subnets)
    destination_internal = is_internal(destination_ip, subnets)

    if source_internal and destination_internal:
        return {
            "source_is_internal": True,
            "destination_is_internal": True,
            "network_direction": "internal",
            "traffic_flow": "internal_lateral",
        }
    if source_internal and not destination_internal:
        return {
            "source_is_internal": True,
            "destination_is_internal": False,
            "network_direction": "outbound",
            "traffic_flow": "internal_to_external",
        }
    if not source_internal and destination_internal:
        return {
            "source_is_internal": False,
            "destination_is_internal": True,
            "network_direction": "inbound",
            "traffic_flow": "external_to_internal",
        }
    return {
        "source_is_internal": False,
        "destination_is_internal": False,
        "network_direction": "external",
        "traffic_flow": "external_to_external",
    }
