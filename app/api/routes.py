from datetime import datetime, timedelta
from ipaddress import ip_address, ip_network

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import String, and_, cast, desc, exists, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_session
from app.models import AlertThreshold, ConfigSubnet, FirewallLog, MetricCatalog, ScopeCatalog
from app.services.ollama import list_ollama_models, stream_ollama

router = APIRouter(prefix="/api")
settings = get_settings()

SUPPORTED_ALERT_METRICS = [
    {
        "name": "blocked_connections_per_source_ip",
        "label": "Connessioni bloccate per source IP",
        "description": "Conta gli eventi con action=block raggruppati per source IP nella finestra temporale.",
    },
    {
        "name": "connections_per_source_port",
        "label": "Connessioni per source port",
        "description": "Conta quante connessioni condividono la stessa source port nella finestra temporale.",
    },
    {
        "name": "distinct_destination_ports_per_source_ip",
        "label": "Porte destinazione distinte per source IP",
        "description": "Conta quante destination port diverse vengono contattate dallo stesso source IP.",
    },
    {
        "name": "events_per_destination_ip",
        "label": "Eventi per destination IP",
        "description": "Conta quanti eventi complessivi coinvolgono lo stesso destination IP.",
    },
]


class SubnetPayload(BaseModel):
    name: str
    cidr: str
    scope: str = "internal"
    enabled: bool = True


class AnalyzePayload(BaseModel):
    model: str = "llama3.1:8b"
    minutes: int = 60
    categories: list[str] = []
    start_time: datetime | None = None
    end_time: datetime | None = None
    prompt: str = (
        "Sei un analista cyber e forense. Analizza i log selezionati, evidenzia pattern sospetti, "
        "priorita', impatti e suggerisci azioni operative. Per gli IP source dammi i dettagli geografici. "
        "Descrivi i grafi source-destination."
    )


class AlertPayload(BaseModel):
    name: str
    metric: str
    threshold: int
    window_seconds: int = 60
    enabled: bool = True


class CatalogItemPayload(BaseModel):
    name: str


class TimelineOverviewPayload(BaseModel):
    minutes: int = 60
    start_time: datetime | None = None
    end_time: datetime | None = None
    tracks: list[str] = ["event", "traffic_flow", "action"]
    collapsed_groups: list[str] = []
    max_rows_per_group: int = 6


class TimelineRowPayload(BaseModel):
    id: str
    track_key: str
    label: str
    value: str | None = None
    aggregated: bool = True


class TimelineDetailPayload(BaseModel):
    start_time: datetime
    end_time: datetime
    rows: list[TimelineRowPayload]


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.app_name}


@router.get("/system/geoip-status")
async def geoip_status(session: AsyncSession = Depends(get_session)) -> dict:
    geocoded_count = await session.scalar(
        select(func.count(FirewallLog.id)).where(FirewallLog.source_lat.is_not(None), FirewallLog.source_lon.is_not(None))
    )
    return {
        "provider": settings.geoip_provider,
        "mmdb_exists": Path(settings.mmdb_path).exists(),
        "mmdb_path": settings.mmdb_path,
        "geocoded_events": geocoded_count or 0,
    }


@router.get("/system/catalogs")
async def catalogs(session: AsyncSession = Depends(get_session)) -> dict:
    subnet_scopes = (await session.execute(select(ScopeCatalog.name).order_by(ScopeCatalog.name))).scalars().all()
    alert_metrics = (await session.execute(select(MetricCatalog.name).order_by(MetricCatalog.name))).scalars().all()
    return {
        "subnet_scopes": [scope for scope in subnet_scopes if scope],
        "alert_metrics": [metric for metric in alert_metrics if metric],
        "supported_alert_metrics": SUPPORTED_ALERT_METRICS,
    }


@router.get("/config/scopes")
async def list_scopes(session: AsyncSession = Depends(get_session)) -> list[dict]:
    rows = await session.scalars(select(ScopeCatalog).order_by(ScopeCatalog.name))
    return [{"id": row.id, "name": row.name} for row in rows]


@router.put("/config/scopes")
async def replace_scopes(payload: list[CatalogItemPayload], session: AsyncSession = Depends(get_session)) -> dict:
    unique_names = sorted({item.name.strip() for item in payload if item.name.strip()})
    await session.execute(ScopeCatalog.__table__.delete())
    session.add_all([ScopeCatalog(name=name) for name in unique_names])
    await session.commit()
    return {"updated": len(unique_names)}


@router.get("/config/metrics")
async def list_metrics(session: AsyncSession = Depends(get_session)) -> list[dict]:
    rows = await session.scalars(select(MetricCatalog).order_by(MetricCatalog.name))
    return [{"id": row.id, "name": row.name} for row in rows]


@router.put("/config/metrics")
async def replace_metrics(payload: list[CatalogItemPayload], session: AsyncSession = Depends(get_session)) -> dict:
    unique_names = sorted({item.name.strip() for item in payload if item.name.strip()})
    await session.execute(MetricCatalog.__table__.delete())
    session.add_all([MetricCatalog(name=name) for name in unique_names])
    await session.commit()
    return {"updated": len(unique_names)}


@router.get("/config/subnets")
async def list_subnets(session: AsyncSession = Depends(get_session)) -> list[dict]:
    rows = await session.scalars(select(ConfigSubnet).order_by(ConfigSubnet.id))
    return [
        {
            "id": row.id,
            "name": row.name,
            "cidr": row.cidr,
            "scope": row.scope,
            "enabled": row.enabled,
        }
        for row in rows
    ]


@router.put("/config/subnets")
async def replace_subnets(payload: list[SubnetPayload], session: AsyncSession = Depends(get_session)) -> dict:
    await session.execute(ConfigSubnet.__table__.delete())
    session.add_all([ConfigSubnet(**item.model_dump()) for item in payload])
    await session.commit()
    return {"updated": len(payload)}


@router.get("/config/alerts")
async def list_alerts(session: AsyncSession = Depends(get_session)) -> list[dict]:
    rows = await session.scalars(select(AlertThreshold).order_by(AlertThreshold.id))
    return [
        {
            "id": row.id,
            "name": row.name,
            "metric": row.metric,
            "threshold": row.threshold,
            "window_seconds": row.window_seconds,
            "enabled": row.enabled,
        }
        for row in rows
    ]


@router.put("/config/alerts")
async def replace_alerts(payload: list[AlertPayload], session: AsyncSession = Depends(get_session)) -> dict:
    await session.execute(AlertThreshold.__table__.delete())
    session.add_all([AlertThreshold(**item.model_dump()) for item in payload])
    await session.commit()
    return {"updated": len(payload)}


def _window(minutes: int) -> datetime:
    return datetime.utcnow() - timedelta(minutes=minutes)


TIMELINE_ALLOWED_TRACKS = {
    "event": FirewallLog.summary,
    "source_ip": FirewallLog.source_ip,
    "destination_ip": FirewallLog.destination_ip,
    "destination_port": FirewallLog.destination_port,
    "traffic_flow": FirewallLog.traffic_flow,
    "action": FirewallLog.action,
}


TIMELINE_TRACK_LABELS = {
    "event": "Eventi generali",
    "source_ip": "Source IP",
    "destination_ip": "Destination IP",
    "destination_port": "Destination port",
    "traffic_flow": "Traffic flow",
    "action": "Action",
}


def _normalize_time_scope(
    minutes: int,
    start_time: datetime | None,
    end_time: datetime | None,
) -> tuple[datetime, datetime]:
    if start_time and end_time:
        return min(start_time, end_time), max(start_time, end_time)
    end = datetime.utcnow()
    return end - timedelta(minutes=minutes), end


def _bucket_seconds_for_span(span_seconds: float) -> int:
    friendly_steps = [
        1,
        5,
        10,
        15,
        30,
        60,
        300,
        600,
        900,
        1800,
        3600,
        7200,
        21600,
        43200,
        86400,
    ]
    ideal = max(1, int(span_seconds / 320))
    for step in friendly_steps:
        if step >= ideal:
            return step
    return friendly_steps[-1]


def _bucket_label(bucket_seconds: int) -> str:
    if bucket_seconds < 60:
        return f"{bucket_seconds}s"
    if bucket_seconds < 3600:
        return f"{bucket_seconds // 60}m"
    if bucket_seconds < 86400:
        return f"{bucket_seconds // 3600}h"
    return f"{bucket_seconds // 86400}d"


def _bucket_floor(value: datetime, bucket_seconds: int) -> datetime:
    ts = int(value.timestamp())
    floored = ts - (ts % bucket_seconds)
    return datetime.utcfromtimestamp(floored)


def _timeline_row_filters(row: TimelineRowPayload):
    if row.aggregated or row.track_key == "event":
        return []
    column = TIMELINE_ALLOWED_TRACKS[row.track_key]
    if row.track_key == "destination_port":
        try:
            return [column == int(row.value)] if row.value is not None else []
        except ValueError:
            return []
    return [column == row.value]


def _serialize_timeline_event(row) -> dict:
    return {
        "id": row.id,
        "time": row.observed_at.isoformat(),
        "track": row.track or "unknown",
        "summary": row.summary,
        "action": row.action,
        "source_ip": row.source_ip,
        "destination_ip": row.destination_ip,
        "destination_port": row.destination_port,
        "traffic_flow": row.traffic_flow,
        "raw_message": row.raw_message,
    }


async def _timeline_bounds(session: AsyncSession) -> tuple[datetime | None, datetime | None]:
    bounds = await session.execute(select(func.min(FirewallLog.observed_at), func.max(FirewallLog.observed_at)))
    return bounds.one()


async def _build_timeline_rows(
    session: AsyncSession,
    start: datetime,
    end: datetime,
    tracks: list[str],
    collapsed_groups: list[str],
    max_rows_per_group: int,
) -> list[TimelineRowPayload]:
    normalized_tracks = [track for track in tracks if track in TIMELINE_ALLOWED_TRACKS]
    collapsed = set(collapsed_groups)
    rows: list[TimelineRowPayload] = []
    base_filters = [FirewallLog.observed_at >= start, FirewallLog.observed_at <= end]

    for track in normalized_tracks:
        label = TIMELINE_TRACK_LABELS[track]
        if track == "event" or track in collapsed:
            rows.append(
                TimelineRowPayload(
                    id=f"{track}::group",
                    track_key=track,
                    label=label,
                    aggregated=True,
                )
            )
            continue

        column = TIMELINE_ALLOWED_TRACKS[track]
        stmt = (
            select(column.label("value"), func.count(FirewallLog.id).label("count"))
            .where(*base_filters, column.is_not(None))
            .group_by(column)
            .order_by(desc("count"))
            .limit(max_rows_per_group)
        )
        values = (await session.execute(stmt)).all()
        if not values:
            rows.append(
                TimelineRowPayload(
                    id=f"{track}::group",
                    track_key=track,
                    label=label,
                    aggregated=True,
                )
            )
            continue

        for value_row in values:
            rows.append(
                TimelineRowPayload(
                    id=f"{track}:{value_row.value}",
                    track_key=track,
                    label=f"{label} / {value_row.value}",
                    value=str(value_row.value),
                    aggregated=False,
                )
            )

    return rows


async def _aggregate_timeline_points(
    session: AsyncSession,
    rows: list[TimelineRowPayload],
    start: datetime,
    end: datetime,
    bucket_seconds: int,
) -> list[dict]:
    dialect = session.bind.dialect.name if session.bind else ""
    base_filters = [FirewallLog.observed_at >= start, FirewallLog.observed_at <= end]
    points: list[dict] = []

    for row in rows:
        row_filters = [*base_filters, *_timeline_row_filters(row)]
        if dialect == "postgresql":
            bucket_expr = func.time_bucket(
                text(f"INTERVAL '{bucket_seconds} seconds'"),
                FirewallLog.observed_at,
            ).label("bucket")
            stmt = (
                select(bucket_expr, func.count(FirewallLog.id).label("count"))
                .where(*row_filters)
                .group_by(bucket_expr)
                .order_by(bucket_expr.asc())
            )
            buckets = (await session.execute(stmt)).all()
            points.extend(
                {
                    "row_id": row.id,
                    "row_label": row.label,
                    "track_key": row.track_key,
                    "bucket_time": bucket.bucket.isoformat(),
                    "count": bucket.count,
                }
                for bucket in buckets
            )
            continue

        timestamps = (
            await session.execute(select(FirewallLog.observed_at).where(*row_filters).order_by(FirewallLog.observed_at.asc()))
        ).scalars().all()
        grouped: dict[datetime, int] = {}
        for timestamp in timestamps:
            bucket_time = _bucket_floor(timestamp, bucket_seconds)
            grouped[bucket_time] = grouped.get(bucket_time, 0) + 1
        points.extend(
            {
                "row_id": row.id,
                "row_label": row.label,
                "track_key": row.track_key,
                "bucket_time": bucket_time.isoformat(),
                "count": count,
            }
            for bucket_time, count in sorted(grouped.items(), key=lambda item: item[0])
        )

    return points


def _derive_classes(source_ip: str | None, destination_ip: str | None, subnets: list[ConfigSubnet]) -> list[str]:
    classes: list[str] = []
    for subnet in subnets:
        if not subnet.enabled:
            continue
        try:
            network = ip_network(subnet.cidr, strict=False)
        except ValueError:
            continue
        matched_roles = []
        try:
            if source_ip and ip_address(source_ip) in network:
                matched_roles.append(f"source:{subnet.name}")
        except ValueError:
            pass
        try:
            if destination_ip and ip_address(destination_ip) in network:
                matched_roles.append(f"destination:{subnet.name}")
        except ValueError:
            pass
        classes.extend(matched_roles)
    return classes


@router.post("/dashboard/timeline/overview")
async def timeline_overview(
    payload: TimelineOverviewPayload,
    session: AsyncSession = Depends(get_session),
) -> dict:
    start, end = _normalize_time_scope(payload.minutes, payload.start_time, payload.end_time)
    absolute_min, absolute_max = await _timeline_bounds(session)
    rows = await _build_timeline_rows(
        session,
        start,
        end,
        payload.tracks,
        payload.collapsed_groups,
        payload.max_rows_per_group,
    )
    span_seconds = max(1.0, (end - start).total_seconds())
    bucket_seconds = _bucket_seconds_for_span(span_seconds)
    points = await _aggregate_timeline_points(session, rows, start, end, bucket_seconds)
    initial_visible_start = start
    return {
        "rows": [row.model_dump() for row in rows],
        "points": points,
        "requested_start": start.isoformat(),
        "requested_end": end.isoformat(),
        "absolute_min_time": absolute_min.isoformat() if absolute_min else None,
        "absolute_max_time": absolute_max.isoformat() if absolute_max else None,
        "bucket_seconds": bucket_seconds,
        "bucket_label": _bucket_label(bucket_seconds),
        "initial_visible_start": initial_visible_start.isoformat(),
        "initial_visible_end": end.isoformat(),
        "buffer_cap": settings.max_timeline_events,
    }


@router.post("/dashboard/timeline/detail")
async def timeline_detail(
    payload: TimelineDetailPayload,
    session: AsyncSession = Depends(get_session),
) -> dict:
    start = min(payload.start_time, payload.end_time)
    end = max(payload.start_time, payload.end_time)
    base_filters = [FirewallLog.observed_at >= start, FirewallLog.observed_at <= end]
    total_events = await session.scalar(select(func.count(FirewallLog.id)).where(*base_filters))
    span_seconds = max(1.0, (end - start).total_seconds())
    detail_event_limit = settings.max_timeline_events if settings.max_timeline_events > 0 else None

    if (detail_event_limit is None or (total_events or 0) <= detail_event_limit) and span_seconds <= 6 * 3600:
        stmt = (
            select(
                FirewallLog.id,
                FirewallLog.observed_at,
                FirewallLog.summary,
                FirewallLog.action,
                FirewallLog.source_ip,
                FirewallLog.destination_ip,
                FirewallLog.destination_port,
                FirewallLog.traffic_flow,
                FirewallLog.summary.label("track"),
                FirewallLog.raw_message,
            )
            .where(*base_filters)
            .order_by(FirewallLog.observed_at.asc())
        )
        if detail_event_limit is not None:
            stmt = stmt.limit(detail_event_limit)
        rows = (await session.execute(stmt)).all()
        return {
            "mode": "events",
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "events_total": total_events or 0,
            "buffer_cap": detail_event_limit,
            "truncated": detail_event_limit is not None and (total_events or 0) > detail_event_limit,
            "events": [_serialize_timeline_event(row) for row in rows],
        }

    bucket_seconds = _bucket_seconds_for_span(span_seconds)
    points = await _aggregate_timeline_points(session, payload.rows, start, end, bucket_seconds)
    return {
        "mode": "aggregate",
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
        "events_total": total_events or 0,
        "bucket_seconds": bucket_seconds,
        "bucket_label": _bucket_label(bucket_seconds),
        "points": points,
        "events": [],
        "buffer_cap": detail_event_limit,
        "truncated": False,
    }


@router.get("/dashboard/timeline")
async def timeline(
    minutes: int = Query(default=settings.default_lookback_minutes, ge=1, le=10080),
    track_by: str = Query(default="traffic_flow"),
    start_time: datetime | None = Query(default=None),
    end_time: datetime | None = Query(default=None),
    limit: int = Query(default=1500, ge=100, le=5000),
    session: AsyncSession = Depends(get_session),
) -> dict:
    allowed = {
        "event": FirewallLog.summary,
        "source_ip": FirewallLog.source_ip,
        "destination_port": FirewallLog.destination_port,
        "traffic_flow": FirewallLog.traffic_flow,
        "action": FirewallLog.action,
    }
    if track_by not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported track_by")
    track_column = allowed[track_by]
    time_filters = []
    if start_time and end_time:
        start = min(start_time, end_time)
        end = max(start_time, end_time)
        time_filters.append(FirewallLog.observed_at >= start)
        time_filters.append(FirewallLog.observed_at <= end)
    else:
        time_filters.append(FirewallLog.observed_at >= _window(minutes))

    stmt = (
        select(
            FirewallLog.id,
            FirewallLog.observed_at,
            FirewallLog.summary,
            FirewallLog.action,
            FirewallLog.source_ip,
            FirewallLog.destination_ip,
            FirewallLog.destination_port,
            FirewallLog.traffic_flow,
            track_column.label("track"),
            FirewallLog.raw_message,
        )
        .where(*time_filters)
        .order_by(FirewallLog.observed_at.asc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    total_in_window = await session.scalar(
        select(func.count(FirewallLog.id)).where(*time_filters)
    )
    bounds = await session.execute(
        select(
            func.min(FirewallLog.observed_at),
            func.max(FirewallLog.observed_at),
        )
        .where(*time_filters)
    )
    min_time, max_time = bounds.one()
    return {
        "track_by": track_by,
        "min_time": min_time.isoformat() if min_time else None,
        "max_time": max_time.isoformat() if max_time else None,
        "window_total": total_in_window or 0,
        "limit": limit,
        "truncated": (total_in_window or 0) > limit,
        "events": [
            {
                "id": row.id,
                "time": row.observed_at.isoformat(),
                "track": row.track or "unknown",
                "summary": row.summary,
                "action": row.action,
                "source_ip": row.source_ip,
                "destination_ip": row.destination_ip,
                "destination_port": row.destination_port,
                "traffic_flow": row.traffic_flow,
                "raw_message": row.raw_message,
            }
            for row in rows
        ],
    }


@router.get("/dashboard/top")
async def top_stats(
    minutes: int = Query(default=settings.default_lookback_minutes, ge=1, le=1440),
    field: str = Query(default="source_ip"),
    limit: int = Query(default=10, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
) -> dict:
    allowed = {
        "source_ip": FirewallLog.source_ip,
        "destination_port": FirewallLog.destination_port,
        "destination_ip": FirewallLog.destination_ip,
        "traffic_flow": FirewallLog.traffic_flow,
        "action": FirewallLog.action,
    }
    if field == "destination_socket":
        stmt = (
            select(
                FirewallLog.destination_ip,
                FirewallLog.destination_port,
                func.count(FirewallLog.id).label("count"),
            )
            .where(FirewallLog.observed_at >= _window(minutes))
            .where(FirewallLog.destination_ip.is_not(None))
            .where(FirewallLog.destination_port.is_not(None))
            .group_by(FirewallLog.destination_ip, FirewallLog.destination_port)
            .order_by(desc("count"))
            .limit(limit)
        )
        rows = (await session.execute(stmt)).all()
        return {
            "field": field,
            "items": [
                {"value": f"{row.destination_ip or 'unknown'}:{row.destination_port or 'na'}", "count": row.count}
                for row in rows
            ],
        }
    if field not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported field")
    column = allowed[field]
    stmt = (
        select(column.label("value"), func.count(FirewallLog.id).label("count"))
        .where(FirewallLog.observed_at >= _window(minutes))
        .where(column.is_not(None))
        .group_by(column)
        .order_by(desc("count"))
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return {"field": field, "items": [{"value": row.value, "count": row.count} for row in rows if row.value is not None]}


@router.get("/dashboard/ip-detail")
async def ip_detail(
    ip: str = Query(..., min_length=1),
    minutes: int = Query(default=1440, ge=1, le=10080),
    session: AsyncSession = Depends(get_session),
) -> dict:
    total_seen = await session.scalar(select(func.count(FirewallLog.id)).where(FirewallLog.source_ip == ip, FirewallLog.observed_at >= _window(minutes)))
    geo_stmt = (
        select(
            FirewallLog.source_country,
            FirewallLog.source_city,
            FirewallLog.source_lat,
            FirewallLog.source_lon,
            func.min(FirewallLog.observed_at),
            func.max(FirewallLog.observed_at),
        )
        .where(FirewallLog.source_ip == ip, FirewallLog.observed_at >= _window(minutes))
        .group_by(FirewallLog.source_country, FirewallLog.source_city, FirewallLog.source_lat, FirewallLog.source_lon)
        .order_by(desc(func.max(FirewallLog.observed_at)))
        .limit(1)
    )
    geo = (await session.execute(geo_stmt)).first()
    top_destinations = (
        await session.execute(
            select(FirewallLog.destination_ip, func.count(FirewallLog.id).label("count"))
            .where(FirewallLog.source_ip == ip, FirewallLog.observed_at >= _window(minutes))
            .group_by(FirewallLog.destination_ip)
            .order_by(desc("count"))
            .limit(5)
        )
    ).all()
    top_ports = (
        await session.execute(
            select(FirewallLog.destination_port, func.count(FirewallLog.id).label("count"))
            .where(FirewallLog.source_ip == ip, FirewallLog.observed_at >= _window(minutes))
            .group_by(FirewallLog.destination_port)
            .order_by(desc("count"))
            .limit(5)
        )
    ).all()
    flows = (
        await session.execute(
            select(FirewallLog.traffic_flow, func.count(FirewallLog.id).label("count"))
            .where(FirewallLog.source_ip == ip, FirewallLog.observed_at >= _window(minutes))
            .group_by(FirewallLog.traffic_flow)
            .order_by(desc("count"))
            .limit(5)
        )
    ).all()
    actions = (
        await session.execute(
            select(FirewallLog.action, func.count(FirewallLog.id).label("count"))
            .where(FirewallLog.source_ip == ip, FirewallLog.observed_at >= _window(minutes))
            .group_by(FirewallLog.action)
            .order_by(desc("count"))
            .limit(5)
        )
    ).all()
    return {
        "ip": ip,
        "total_seen": total_seen or 0,
        "country": geo[0] if geo else None,
        "city": geo[1] if geo else None,
        "lat": geo[2] if geo else None,
        "lon": geo[3] if geo else None,
        "first_seen": geo[4].isoformat() if geo and geo[4] else None,
        "last_seen": geo[5].isoformat() if geo and geo[5] else None,
        "top_destinations": [{"value": row[0] or "unknown", "count": row[1]} for row in top_destinations],
        "top_ports": [{"value": row[0] or "unknown", "count": row[1]} for row in top_ports],
        "flows": [{"value": row[0] or "unknown", "count": row[1]} for row in flows],
        "actions": [{"value": row[0] or "unknown", "count": row[1]} for row in actions],
    }


@router.get("/dashboard/logs")
async def log_rows(
    minutes: int = Query(default=1440, ge=1, le=10080),
    start_time: datetime | None = Query(default=None),
    end_time: datetime | None = Query(default=None),
    limit: int = Query(default=250, ge=1, le=2000),
    offset: int = Query(default=0, ge=0, le=200000),
    time_filter: str | None = Query(default=None),
    flow_filter: str | None = Query(default=None),
    action_filter: str | None = Query(default=None),
    source_filter: str | None = Query(default=None),
    destination_filter: str | None = Query(default=None),
    classes_filter: str | None = Query(default=None),
    protocol_filter: str | None = Query(default=None),
    geo_filter: str | None = Query(default=None),
    summary_filter: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    subnets = (await session.scalars(select(ConfigSubnet).order_by(ConfigSubnet.id))).all()
    normalized_class_filter = classes_filter.strip().lower() if classes_filter else None
    start, end = _normalize_time_scope(minutes, start_time, end_time)
    stmt = select(FirewallLog).where(FirewallLog.observed_at >= start, FirewallLog.observed_at <= end)
    if time_filter:
        stmt = stmt.where(cast(FirewallLog.observed_at, String).ilike(f"%{time_filter.strip()}%"))
    if flow_filter:
        stmt = stmt.where(FirewallLog.traffic_flow.ilike(f"%{flow_filter.strip()}%"))
    if action_filter:
        stmt = stmt.where(FirewallLog.action.ilike(f"%{action_filter.strip()}%"))
    if source_filter:
        normalized = source_filter.strip()
        stmt = stmt.where(
            or_(
                FirewallLog.source_ip.ilike(f"%{normalized}%"),
                cast(FirewallLog.source_port, String).ilike(f"%{normalized}%"),
                func.concat(FirewallLog.source_ip, ":", cast(FirewallLog.source_port, String)).ilike(f"%{normalized}%"),
            )
        )
    if destination_filter:
        normalized = destination_filter.strip()
        stmt = stmt.where(
            or_(
                FirewallLog.destination_ip.ilike(f"%{normalized}%"),
                cast(FirewallLog.destination_port, String).ilike(f"%{normalized}%"),
                func.concat(FirewallLog.destination_ip, ":", cast(FirewallLog.destination_port, String)).ilike(f"%{normalized}%"),
            )
        )
    if protocol_filter:
        stmt = stmt.where(FirewallLog.protocol.ilike(f"%{protocol_filter.strip()}%"))
    if geo_filter:
        normalized = geo_filter.strip()
        stmt = stmt.where(
            or_(
                FirewallLog.source_country.ilike(f"%{normalized}%"),
                FirewallLog.source_city.ilike(f"%{normalized}%"),
            )
        )
    if summary_filter:
        normalized = summary_filter.strip()
        stmt = stmt.where(
            or_(
                FirewallLog.summary.ilike(f"%{normalized}%"),
                FirewallLog.raw_message.ilike(f"%{normalized}%"),
            )
        )

    def serialize_row(row: FirewallLog) -> dict:
        return {
            "id": row.id,
            "observed_at": row.observed_at.isoformat() if row.observed_at else None,
            "ingested_at": row.ingested_at.isoformat() if row.ingested_at else None,
            "summary": row.summary,
            "action": row.action,
            "event_outcome": row.event_outcome,
            "interface": row.interface,
            "protocol": row.protocol,
            "reason": row.reason,
            "source_ip": row.source_ip,
            "source_port": row.source_port,
            "destination_ip": row.destination_ip,
            "destination_port": row.destination_port,
            "classes": _derive_classes(row.source_ip, row.destination_ip, subnets),
            "traffic_flow": row.traffic_flow,
            "network_direction": row.network_direction,
            "source_country": row.source_country,
            "source_city": row.source_city,
            "source_lat": row.source_lat,
            "source_lon": row.source_lon,
            "host_name": row.host_name,
            "process_name": row.process_name,
            "process_pid": row.process_pid,
            "tracker": row.tracker,
            "length": row.length,
            "ttl": row.ttl,
            "tcp_flags": row.tcp_flags,
            "data_length": row.data_length,
            "raw_message": row.raw_message,
            "parse_error": row.parse_error,
        }

    # Classe is derived dynamically from configured subnets, so when filtering by class
    # we apply the match after row serialization instead of using incorrect SQL shortcuts.
    if normalized_class_filter:
        batch_size = min(max(limit * 2, 250), 2000)
        scan_offset = 0
        skipped_matches = 0
        total = 0
        items: list[dict] = []
        base_stmt = stmt.order_by(desc(FirewallLog.observed_at))
        while True:
            rows = (await session.scalars(base_stmt.offset(scan_offset).limit(batch_size))).all()
            if not rows:
                break
            scan_offset += len(rows)
            for row in rows:
                item = serialize_row(row)
                if not any(normalized_class_filter in value.lower() for value in item["classes"]):
                    continue
                total += 1
                if skipped_matches < offset:
                    skipped_matches += 1
                    continue
                if len(items) < limit:
                    items.append(item)
        return {
            "items": items,
            "offset": offset,
            "limit": limit,
            "total": total,
            "has_more": (offset + len(items)) < total,
        }

    total_stmt = select(func.count()).select_from(stmt.subquery())
    total = await session.scalar(total_stmt)
    rows = (await session.scalars(stmt.order_by(desc(FirewallLog.observed_at)).offset(offset).limit(limit))).all()
    items = [serialize_row(row) for row in rows]
    return {
        "items": items,
        "offset": offset,
        "limit": limit,
        "total": total or 0,
        "has_more": (offset + len(items)) < (total or 0),
    }


@router.get("/system/ollama-models")
async def ollama_models() -> dict:
    try:
        models = await list_ollama_models(settings.ollama_url)
    except Exception:
        models = []
    if "llama3.1:8b" not in models:
        models = ["llama3.1:8b", *models]
    return {"models": models}


@router.get("/dashboard/map")
async def map_data(
    minutes: int = Query(default=settings.default_lookback_minutes, ge=1, le=10080),
    start_time: datetime | None = Query(default=None),
    end_time: datetime | None = Query(default=None),
    north: float | None = Query(default=None),
    south: float | None = Query(default=None),
    east: float | None = Query(default=None),
    west: float | None = Query(default=None),
    limit: int = Query(default=150, ge=10, le=1000),
    session: AsyncSession = Depends(get_session),
) -> dict:
    start, end = _normalize_time_scope(minutes, start_time, end_time)
    stmt = (
        select(
            FirewallLog.source_ip,
            FirewallLog.source_port,
            FirewallLog.destination_ip,
            FirewallLog.destination_port,
            FirewallLog.source_country,
            FirewallLog.source_city,
            FirewallLog.source_lat,
            FirewallLog.source_lon,
            func.count(FirewallLog.id).label("count"),
        )
        .where(FirewallLog.observed_at >= start)
        .where(FirewallLog.observed_at <= end)
        .where(FirewallLog.traffic_flow == "external_to_internal")
        .where(FirewallLog.source_ip.is_not(None))
        .where(FirewallLog.destination_ip.is_not(None))
        .where(FirewallLog.destination_port.is_not(None))
        .where(FirewallLog.source_lat.is_not(None))
        .where(FirewallLog.source_lon.is_not(None))
        .group_by(
            FirewallLog.source_ip,
            FirewallLog.source_port,
            FirewallLog.destination_ip,
            FirewallLog.destination_port,
            FirewallLog.source_country,
            FirewallLog.source_city,
            FirewallLog.source_lat,
            FirewallLog.source_lon,
        )
        .order_by(desc("count"))
        .limit(limit)
    )
    if None not in (north, south, east, west):
        stmt = stmt.where(
            FirewallLog.source_lat <= north,
            FirewallLog.source_lat >= south,
            FirewallLog.source_lon <= east,
            FirewallLog.source_lon >= west,
        )
    rows = (await session.execute(stmt)).all()
    return {
        "requested_start": start.isoformat(),
        "requested_end": end.isoformat(),
        "truncated": len(rows) >= limit,
        "points": [
            {
                "source_ip": row.source_ip,
                "source_port": row.source_port,
                "destination_ip": row.destination_ip,
                "destination_port": row.destination_port,
                "country": row.source_country,
                "city": row.source_city,
                "lat": row.source_lat,
                "lon": row.source_lon,
                "count": row.count,
            }
            for row in rows
        ]
    }


@router.get("/dashboard/graph")
async def graph_data(
    minutes: int = Query(default=settings.default_lookback_minutes, ge=1, le=10080),
    start_time: datetime | None = Query(default=None),
    end_time: datetime | None = Query(default=None),
    limit: int = Query(default=120, ge=20, le=1000),
    session: AsyncSession = Depends(get_session),
) -> dict:
    start, end = _normalize_time_scope(minutes, start_time, end_time)
    stmt = (
        select(
            FirewallLog.source_ip,
            FirewallLog.source_port,
            FirewallLog.destination_ip,
            FirewallLog.destination_port,
            func.count(FirewallLog.id).label("count"),
        )
        .where(FirewallLog.observed_at >= start)
        .where(FirewallLog.observed_at <= end)
        .where(FirewallLog.source_ip.is_not(None))
        .where(FirewallLog.source_port.is_not(None))
        .where(FirewallLog.destination_ip.is_not(None))
        .where(FirewallLog.destination_port.is_not(None))
        .group_by(
            FirewallLog.source_ip,
            FirewallLog.source_port,
            FirewallLog.destination_ip,
            FirewallLog.destination_port,
        )
        .order_by(desc("count"))
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    nodes = {}
    edge_weights: dict[tuple[str, str], int] = {}
    for row in rows:
        source = row.source_ip
        source_socket = f"{row.source_ip}:{row.source_port}"
        destination = row.destination_ip
        destination_socket = f"{row.destination_ip}:{row.destination_port}"
        nodes[source] = {"id": source, "name": source, "category": "source"}
        nodes[destination] = {"id": destination, "name": destination, "category": "destination"}
        nodes[source_socket] = {
            "id": source_socket,
            "name": source_socket,
            "category": "service",
            "kind": "source_socket",
        }
        nodes[destination_socket] = {
            "id": destination_socket,
            "name": destination_socket,
            "category": "service",
            "kind": "destination_socket",
        }
        for edge in (
            (source, source_socket),
            (source_socket, destination_socket),
            (destination_socket, destination),
        ):
            edge_weights[edge] = edge_weights.get(edge, 0) + row.count
    edges = [
        {"source": source, "target": target, "value": value}
        for (source, target), value in edge_weights.items()
    ]
    return {
        "requested_start": start.isoformat(),
        "requested_end": end.isoformat(),
        "truncated": len(rows) >= limit,
        "nodes": list(nodes.values()),
        "edges": edges,
    }


@router.post("/ai/analyze")
async def analyze(payload: AnalyzePayload, session: AsyncSession = Depends(get_session)):
    time_filters = []
    if payload.start_time and payload.end_time:
        start = min(payload.start_time, payload.end_time)
        end = max(payload.start_time, payload.end_time)
        time_filters.append(FirewallLog.observed_at >= start)
        time_filters.append(FirewallLog.observed_at <= end)
        time_scope = f"Intervallo esplicito: {start.isoformat()} -> {end.isoformat()}."
    else:
        time_filters.append(FirewallLog.observed_at >= _window(payload.minutes))
        time_scope = f"Finestra temporale selezionata: ultimi {payload.minutes} minuti."

    stmt = (
        select(
            FirewallLog.observed_at,
            FirewallLog.raw_message,
            FirewallLog.interface,
            FirewallLog.reason,
            FirewallLog.action,
            FirewallLog.event_outcome,
            FirewallLog.protocol,
            FirewallLog.host_name,
            FirewallLog.process_name,
            FirewallLog.process_pid,
            FirewallLog.source_ip,
            FirewallLog.source_port,
            FirewallLog.destination_ip,
            FirewallLog.destination_port,
            FirewallLog.traffic_flow,
            FirewallLog.network_direction,
            FirewallLog.summary,
            FirewallLog.source_country,
            FirewallLog.source_city,
            FirewallLog.source_lat,
            FirewallLog.source_lon,
            FirewallLog.source_is_internal,
            FirewallLog.destination_is_internal,
        )
        .where(*time_filters)
        .order_by(desc(FirewallLog.observed_at))
    )
    if payload.categories:
        stmt = stmt.where(FirewallLog.traffic_flow.in_(payload.categories))
    rows = (await session.execute(stmt)).all()
    total_rows = len(rows)
    compact_logs = [
        (
            f"{row.observed_at.isoformat()} | {row.action} | outcome={row.event_outcome or 'n/a'} | "
            f"{row.protocol} | iface={row.interface or 'n/a'} | reason={row.reason or 'n/a'} | "
            f"host={row.host_name or 'n/a'} | process={row.process_name or 'n/a'}[{row.process_pid or 'n/a'}] | "
            f"{row.source_ip}:{row.source_port} -> {row.destination_ip}:{row.destination_port} | "
            f"{row.traffic_flow} | direction={row.network_direction or 'n/a'} | src_internal={row.source_is_internal} | "
            f"dst_internal={row.destination_is_internal} | "
            f"geo_src={row.source_country or 'n/a'}/{row.source_city or 'n/a'} "
            f"({row.source_lat if row.source_lat is not None else 'n/a'},"
            f"{row.source_lon if row.source_lon is not None else 'n/a'}) | "
            f"{row.summary} | raw={row.raw_message}"
        )
        for row in rows
    ]
    prompt = (
        f"{payload.prompt}\n\n"
        f"{time_scope}\n"
        f"Categorie selezionate: {', '.join(payload.categories) if payload.categories else 'tutte'}.\n"
        f"Numero totale log inclusi nel dataset: {total_rows}.\n\n"
        f"Log selezionati:\n" + "\n".join(compact_logs)
    )

    async def event_stream():
        async for chunk in stream_ollama(
            settings.ollama_url,
            {
                "model": payload.model,
                "prompt": prompt,
                "stream": True,
                "options": {"num_ctx": settings.ollama_num_ctx},
            },
        ):
            yield chunk

    return StreamingResponse(event_stream(), media_type="text/plain")
