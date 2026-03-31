import csv
import io
import re
from datetime import datetime
from ipaddress import ip_address

from dateutil import tz


SYSLOG_RE = re.compile(
    r"^(?:<(?P<priority>\d+)>)?(?P<timestamp>[A-Z][a-z]{2}\s+\d+\s+\d\d:\d\d:\d\d)\s+"
    r"(?:(?P<host>\S+)\s+)?(?P<process>[\w\-\/\.]+)(?:\[(?P<pid>\d+)\])?:\s(?P<message>.*)$"
)

SYSLOG_HOST_ONLY_RE = re.compile(
    r"^(?:<(?P<priority>\d+)>)?(?P<timestamp>[A-Z][a-z]{2}\s+\d+\s+\d\d:\d\d:\d\d)\s+"
    r"(?P<host>\S+)\s+(?P<message>.*)$"
)

PF_FIELDS = [
    "rule_number",
    "sub_rule",
    "anchor",
    "tracker",
    "interface",
    "reason",
    "action",
    "direction",
    "ip_version",
    "tos",
    "ecn",
    "ttl",
    "id",
    "offset",
    "flags",
    "protocol_id",
    "protocol",
    "length",
    "source_ip",
    "destination_ip",
    "source_port",
    "destination_port",
    "data_length",
    "tcp_flags",
    "sequence_number",
    "ack_number",
    "window",
    "urg",
    "options",
]

INT_FIELDS = {
    "rule_number",
    "sub_rule",
    "ttl",
    "id",
    "offset",
    "protocol_id",
    "length",
    "source_port",
    "destination_port",
    "data_length",
    "sequence_number",
    "ack_number",
    "window",
    "urg",
}

CEF_HEADER_RE = re.compile(
    r"^CEF:(?P<version>\d+)\|(?P<vendor>[^|]*)\|(?P<product>[^|]*)\|(?P<device_version>[^|]*)\|"
    r"(?P<signature>[^|]*)\|(?P<name>[^|]*)\|(?P<severity>[^|]*)\|(?P<extension>.*)$"
)

UNIFI_DEVICE_RE = re.compile(
    r'^\("(?P<model>[^,"]+),(?P<device_mac>[0-9a-fA-F]+),(?P<version>[^"]+)"\)\s+(?P<body>.*)$'
)

UNIFI_BODY_RE = re.compile(
    r"^(?P<component>[\w\-\/]+):\s+(?:(?P<subsystem>[^:]+):\s+)?(?P<detail>.*)$"
)

STA_EVENT_RE = re.compile(
    r"^STA\s+(?P<client_mac>(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})\s+"
    r"(?:(?P<context>[A-Z0-9.\- ]+):\s+)?(?P<detail>.*)$"
)


def _parse_timestamp(value: str, timezone_name: str) -> datetime:
    current_year = datetime.now(tz=tz.gettz(timezone_name)).year
    naive = datetime.strptime(f"{current_year} {value}", "%Y %b %d %H:%M:%S")
    return naive.replace(tzinfo=tz.gettz(timezone_name))


def parse_syslog_message(raw_message: str, timezone_name: str) -> dict:
    base = {
        "raw_message": raw_message,
        "event_original": raw_message,
        "process_name": None,
        "process_pid": None,
        "host_name": None,
        "parse_error": None,
        "observed_at": datetime.now(tz=tz.gettz(timezone_name)),
        "enrichment_status": "skipped",
    }

    raw_line = raw_message.strip()
    header_match = SYSLOG_RE.match(raw_line)
    if header_match:
        header = header_match.groupdict()
        base["observed_at"] = _parse_timestamp(header["timestamp"], timezone_name)
        base["host_name"] = header.get("host")
        base["process_name"] = header.get("process")
        base["process_pid"] = int(header["pid"]) if header.get("pid") else None
        syslog_message = header["message"]
    else:
        fallback_match = SYSLOG_HOST_ONLY_RE.match(raw_line)
        if not fallback_match:
            base["parse_error"] = "syslog_header_parse_failure"
            return base
        header = fallback_match.groupdict()
        base["observed_at"] = _parse_timestamp(header["timestamp"], timezone_name)
        base["host_name"] = header.get("host")
        syslog_message = header["message"]
    if base["process_name"] == "filterlog":
        reader = csv.reader(io.StringIO(syslog_message))
        values = next(reader, [])
        if len(values) >= 9 and values[8] in {"4", "6"}:
            data = dict(zip(PF_FIELDS, values))
            parsed = _normalize_filterlog_fields(data)
            base.update(parsed)
            return base

    if syslog_message.startswith("CEF:"):
        parsed = _parse_unifi_cef_message(syslog_message)
        if parsed:
            base.update(parsed)
            return base

    unifi_message = syslog_message
    if base["process_name"] and "," in base["process_name"] and not syslog_message.startswith('("'):
        unifi_message = f"{base['process_name']}: {syslog_message}"
        base["process_name"] = None
        base["process_pid"] = None

    parsed = _parse_unifi_device_message(unifi_message, base["process_name"], base["host_name"])
    if parsed:
        base.update(parsed)
        return base

    base.update(
        {
            "summary": syslog_message,
            "enrichment_status": "skipped",
        }
    )
    return base


def _normalize_filterlog_fields(data: dict) -> dict:
    normalized: dict = {}
    for key, value in data.items():
        if value == "":
            normalized[key] = None
        elif key in INT_FIELDS:
            try:
                normalized[key] = int(value)
            except ValueError:
                normalized[key] = None
        else:
            normalized[key] = value

    action = normalized.get("action")
    protocol = (normalized.get("protocol") or "").lower() or None
    source_port = normalized.get("source_port") if protocol in {"tcp", "udp"} else None
    destination_port = normalized.get("destination_port") if protocol in {"tcp", "udp"} else None
    data_length = normalized.get("data_length") if protocol in {"tcp", "udp"} else None

    return {
        "tracker": normalized.get("tracker"),
        "interface": normalized.get("interface"),
        "reason": normalized.get("reason"),
        "action": action,
        "firewall_direction": normalized.get("direction"),
        "ip_version": str(normalized.get("ip_version")) if normalized.get("ip_version") is not None else None,
        "protocol_id": normalized.get("protocol_id"),
        "protocol": protocol,
        "length": normalized.get("length"),
        "ttl": normalized.get("ttl"),
        "source_ip": normalized.get("source_ip"),
        "destination_ip": normalized.get("destination_ip"),
        "source_port": source_port,
        "destination_port": destination_port,
        "data_length": data_length,
        "tcp_flags": normalized.get("tcp_flags"),
        "event_outcome": "failure" if action == "block" else "success",
        "network_type": "ipv4" if normalized.get("ip_version") == "4" else "ipv6",
        "summary": (
            f"pfSense firewall {action} {protocol or 'ip'} "
            f"{normalized.get('source_ip')}:{source_port} -> {normalized.get('destination_ip')}:{destination_port}"
        ),
        "enrichment_status": "pending",
    }


def _parse_unifi_cef_message(message: str) -> dict | None:
    header_match = CEF_HEADER_RE.match(message.strip())
    if not header_match:
        return None

    cef = header_match.groupdict()
    extension = _parse_cef_extension(cef["extension"])
    source_ip = (
        extension.get("UNIFIclientIp")
        or extension.get("src")
        or extension.get("sourceAddress")
        or extension.get("shost")
    )
    destination_ip = (
        extension.get("UNIFIconnectedToDeviceIp")
        or extension.get("UNIFIlastConnectedToDeviceIp")
        or extension.get("dst")
        or extension.get("destinationAddress")
        or extension.get("dhost")
    )
    source_port = _to_int(extension.get("spt") or extension.get("sourcePort"))
    destination_port = _to_int(
        extension.get("UNIFIconnectedToDevicePort")
        or extension.get("UNIFIlastConnectedToDevicePort")
        or extension.get("dpt")
        or extension.get("destinationPort")
    )
    protocol = (extension.get("proto") or extension.get("app") or "").lower() or None
    name = cef.get("name") or extension.get("UNIFIcategory") or extension.get("cat") or "unifi_event"
    detail = extension.get("msg") or extension.get("cs1") or extension.get("request") or name
    category = extension.get("UNIFIcategory") or extension.get("cat") or extension.get("cs2")
    action = _derive_unifi_action(name, detail, category)
    host_name = (
        extension.get("UNIFIhost")
        or extension.get("dvchost")
        or extension.get("dhost")
        or extension.get("deviceHostName")
    )

    return {
        "host_name": host_name or None,
        "process_name": "unifi-cef",
        "tracker": cef.get("signature") or extension.get("eventId") or extension.get("UNIFIclientMac"),
        "interface": (
            extension.get("UNIFIconnectedToApName")
            or extension.get("UNIFInetworkVlan")
            or extension.get("deviceInterface")
            or extension.get("cs3")
        ),
        "reason": category or extension.get("outcome") or extension.get("cs4"),
        "action": action,
        "protocol": protocol,
        "source_ip": source_ip,
        "destination_ip": destination_ip,
        "source_port": source_port,
        "destination_port": destination_port,
        "network_type": _infer_network_type(source_ip, destination_ip),
        "event_outcome": _derive_unifi_outcome(action, detail),
        "summary": (
            f"UniFi {name}: {detail}"
            f"{f' [{source_ip} -> {destination_ip}]' if source_ip or destination_ip else ''}"
        ),
        "enrichment_status": "pending" if source_ip else "skipped",
    }


def _parse_cef_extension(extension: str) -> dict[str, str]:
    result: dict[str, str] = {}
    if not extension:
        return result

    matches = list(re.finditer(r"(\w+)=", extension))
    for index, match in enumerate(matches):
        key = match.group(1)
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(extension)
        result[key] = extension[start:end].strip()
    return result


def _parse_unifi_device_message(message: str, process_name: str | None, host_name: str | None) -> dict | None:
    device_match = UNIFI_DEVICE_RE.match(message.strip())
    if device_match:
        device = device_match.groupdict()
        body = device["body"]
        body_match = UNIFI_BODY_RE.match(body)
        component = body_match.group("component") if body_match else process_name or "unifi-device"
        subsystem = body_match.group("subsystem").strip() if body_match and body_match.group("subsystem") else None
        detail = body_match.group("detail").strip() if body_match else body.strip()
        sta_match = STA_EVENT_RE.match(detail)
        client_mac = None
        context = None
        if sta_match:
            client_mac = sta_match.group("client_mac")
            context = sta_match.group("context")
            detail = sta_match.group("detail").strip()
        action = _derive_unifi_action(component, detail, subsystem or context)
        return {
            "host_name": host_name,
            "process_name": component,
            "tracker": f"{device['model']}:{device['device_mac']}",
            "interface": subsystem,
            "reason": context or subsystem or device["model"],
            "action": action,
            "event_outcome": _derive_unifi_outcome(action, detail),
            "summary": _build_unifi_summary(device["model"], component, subsystem, client_mac, detail),
            "enrichment_status": "skipped",
        }

    prefixed_match = re.match(
        r"^(?P<prefix>[^:]+):\s*:?\s*(?P<component>[\w\-\/]+(?:\[\d+\])?)(?::\s+(?P<detail>.*))?$",
        message.strip(),
    )
    if prefixed_match and "," in prefixed_match.group("prefix"):
        device_prefix = prefixed_match.group("prefix").strip()
        component = prefixed_match.group("component").strip()
        detail = (prefixed_match.group("detail") or "").strip().lstrip(": ").strip()
        component_pid_match = re.match(r"^(?P<proc>[\w\-\/]+)\[(?P<pid>\d+)\]$", component)
        process_pid = None
        if component_pid_match:
            component = component_pid_match.group("proc")
            process_pid = int(component_pid_match.group("pid"))
        nested_match = re.match(r"^(?P<proc>[\w\-\/]+)\[(?P<pid>\d+)\]:\s+(?P<detail>.*)$", detail)
        if nested_match:
            component = nested_match.group("proc")
            process_pid = int(nested_match.group("pid"))
            detail = nested_match.group("detail").strip()
        detail = re.sub(r"^\[[^\]]+\]\s*", "", detail)
        hostapd_match = re.match(
            r"^(?P<iface>[\w\-]+):\s+STA\s+(?P<client_mac>(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})\s+"
            r"(?:(?P<context>[A-Z0-9.\- ]+):\s+)?(?P<detail>.*)$",
            detail,
        )
        port_link_match = re.match(r"^Port\s+(?P<port>\d+)\s+link\s+(?P<state>up|down)$", detail, re.IGNORECASE)
        dropbear_match = re.match(
            r"^Exit before auth from <(?P<source_ip>\d+\.\d+\.\d+\.\d+):(?P<source_port>\d+)>:\s+\(user '(?P<user>[^']+)'(?:,\s*(?P<fails>\d+)\s+fails)?\):\s+(?P<detail>.*)$",
            detail,
        )
        dhcp_match = re.match(r"^\[DHCP-SM\]\s+(?P<client_mac>(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}):\s+(?P<detail>.*)$", detail, re.IGNORECASE)
        keepalive_match = re.match(
            r"^\[keep-alive\]:\s+(?P<client_mac>(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})\s+slient for\s+(?P<seconds>\d+)-sec,.*AID=(?P<aid>\d+)",
            detail,
            re.IGNORECASE,
        )
        deauth_match = re.match(
            r"^(?P<iface>[\w\-]+):\[send deauth\]\s+TA:\[(?P<ta>(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})\],\s+RA:\[(?P<ra>(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})\].*reason:(?P<reason_code>\d+)",
            detail,
            re.IGNORECASE,
        )
        sta_tracker_json_match = re.search(r"(\{.*\})$", detail)
        interface = None
        reason = device_prefix.split(",", 1)[1] if "," in device_prefix else device_prefix
        source_ip = None
        destination_ip = None
        source_port = None
        destination_port = None
        protocol = None
        if hostapd_match:
            interface = hostapd_match.group("iface")
            client_mac = hostapd_match.group("client_mac")
            context = hostapd_match.group("context")
            detail = hostapd_match.group("detail").strip()
            reason = context or interface or reason
            detail = f"{client_mac} {detail}".strip()
        elif port_link_match:
            destination_port = int(port_link_match.group("port"))
            detail = f"Port {destination_port} link {port_link_match.group('state').lower()}"
            reason = "switch-port-link"
        elif dropbear_match:
            source_ip = dropbear_match.group("source_ip")
            source_port = int(dropbear_match.group("source_port"))
            detail = f"user={dropbear_match.group('user')} {dropbear_match.group('detail')}".strip()
            reason = "ssh-auth"
            protocol = "tcp"
        elif dhcp_match:
            detail = f"{dhcp_match.group('client_mac')} {dhcp_match.group('detail')}".strip()
            reason = "dhcp-state"
        elif keepalive_match:
            detail = f"{keepalive_match.group('client_mac')} keep-alive silent={keepalive_match.group('seconds')}s aid={keepalive_match.group('aid')}"
            reason = "wifi-keepalive"
        elif deauth_match:
            interface = deauth_match.group("iface")
            detail = f"AP {deauth_match.group('ta')} -> client {deauth_match.group('ra')} deauth reason={deauth_match.group('reason_code')}"
            reason = "wifi-deauth"
        elif sta_tracker_json_match:
            tracker_event = _parse_sta_tracker_json(sta_tracker_json_match.group(1))
            if tracker_event:
                interface = tracker_event.get("interface")
                reason = tracker_event.get("reason") or reason
                detail = tracker_event.get("detail") or detail
        elif component == "wevent":
            wevent_match = re.match(
                r"^wevent\.ubnt_custom_event\(\):\s+(?P<event>[A-Z_]+)\s+(?P<iface>[\w\-]+):\s+"
                r"(?P<client_mac>(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2})\s+/\s+(?P<value>\S+)$",
                detail,
            )
            if wevent_match:
                interface = wevent_match.group("iface")
                reason = wevent_match.group("event").lower()
                detail = f"{wevent_match.group('client_mac')} {wevent_match.group('event')} {wevent_match.group('value')}"
                if wevent_match.group("event") == "EVENT_STA_IP":
                    source_ip = wevent_match.group("value")

        action = _derive_unifi_action(component, detail, device_prefix)
        return {
            "host_name": host_name,
            "process_name": component,
            "process_pid": process_pid,
            "tracker": device_prefix,
            "interface": interface,
            "reason": reason,
            "action": action,
            "protocol": protocol,
            "source_ip": source_ip,
            "destination_ip": destination_ip,
            "source_port": source_port,
            "destination_port": destination_port,
            "network_type": _infer_network_type(source_ip, destination_ip),
            "event_outcome": _derive_unifi_outcome(action, detail),
            "summary": f"UniFi {host_name or 'device'} / {component}: {detail or device_prefix}",
            "enrichment_status": "pending" if source_ip else "skipped",
        }

    if process_name in {"switch", "hostapd", "mcad", "ace_reporter", "ubnt-discover", "kernel", "stahtd", "dropbear"}:
        normalized_message = message.strip().lstrip(": ").strip()
        body_match = UNIFI_BODY_RE.match(normalized_message)
        subsystem = body_match.group("subsystem").strip() if body_match and body_match.group("subsystem") else None
        detail = body_match.group("detail").strip() if body_match else normalized_message
        detail = re.sub(r"^\[[^\]]+\]\s*", "", detail)
        action = _derive_unifi_action(process_name, detail, subsystem)
        destination_port = None
        source_ip = None
        source_port = None
        protocol = None
        reason = subsystem
        interface = subsystem
        port_link_match = re.match(r"^Port\s+(?P<port>\d+)\s+link\s+(?P<state>up|down)$", detail, re.IGNORECASE)
        if port_link_match:
            destination_port = int(port_link_match.group("port"))
            detail = f"Port {destination_port} link {port_link_match.group('state').lower()}"
            reason = "switch-port-link"
            interface = None
        return {
            "host_name": host_name,
            "process_name": process_name,
            "interface": interface,
            "reason": reason,
            "action": action,
            "protocol": protocol,
            "source_ip": source_ip,
            "source_port": source_port,
            "destination_port": destination_port,
            "event_outcome": _derive_unifi_outcome(action, detail),
            "summary": f"UniFi {process_name}{f' {subsystem}' if subsystem else ''}: {detail}",
            "enrichment_status": "skipped",
        }

    return None


def _build_unifi_summary(model: str, component: str, subsystem: str | None, client_mac: str | None, detail: str) -> str:
    parts = [f"UniFi {model}", component]
    if subsystem:
        parts.append(subsystem)
    if client_mac:
        parts.append(client_mac)
    prefix = " / ".join(parts)
    return f"{prefix}: {detail}"


def _derive_unifi_action(*values: str | None) -> str | None:
    haystack = " ".join((value or "").lower() for value in values)
    action_map = [
        ("disconnect", ("disassociated", "deauthenticated", "disconnected", "offline", "link down", "down")),
        ("connect", ("associated", "connected", "adopted", "joined", "link up", "up")),
        ("roam", ("roamed", "sta_roam", "roam")),
        ("block", ("blocked", "deny", "denied", "dropped")),
        ("alert", ("rogue", "intrusion", "threat", "security", "critical")),
        ("update", ("upgrade", "upgraded", "firmware", "updated")),
    ]
    for action, keywords in action_map:
        if any(keyword in haystack for keyword in keywords):
            return action
    return "event"


def _derive_unifi_outcome(action: str | None, detail: str | None) -> str | None:
    haystack = f"{action or ''} {detail or ''}".lower()
    if any(keyword in haystack for keyword in ("block", "disconnect", "down", "offline", "fail", "denied", "dropped")):
        return "failure"
    if any(keyword in haystack for keyword in ("connect", "up", "success", "adopted", "joined")):
        return "success"
    return None


def _infer_network_type(source_ip: str | None, destination_ip: str | None) -> str | None:
    for value in (source_ip, destination_ip):
        if not value:
            continue
        try:
            return "ipv6" if ip_address(value).version == 6 else "ipv4"
        except ValueError:
            continue
    return None


def _to_int(value: str | None) -> int | None:
    if value in {None, ""}:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_sta_tracker_json(payload: str) -> dict[str, str] | None:
    try:
        import json

        data = json.loads(payload)
    except Exception:
        return None

    event_type = data.get("event_type") or data.get("message_type")
    interface = data.get("vap")
    mac = data.get("mac")
    avg_rssi = data.get("avg_rssi")
    detail_parts = [part for part in [event_type, mac, f"rssi={avg_rssi}" if avg_rssi else None] if part]
    return {
        "interface": interface,
        "reason": "sta-tracker",
        "detail": " ".join(detail_parts) if detail_parts else payload,
    }
