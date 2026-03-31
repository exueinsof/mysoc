import asyncio

from sqlalchemy import or_, select

from app.db.session import SessionLocal
from app.models import FirewallLog
from app.services.parser import parse_syslog_message


FIELDS = [
    "host_name",
    "process_name",
    "process_pid",
    "tracker",
    "interface",
    "reason",
    "action",
    "protocol",
    "source_ip",
    "source_port",
    "destination_ip",
    "destination_port",
    "event_outcome",
    "network_type",
    "summary",
    "parse_error",
    "enrichment_status",
]


async def main() -> None:
    async with SessionLocal() as session:
        rows = (
            await session.scalars(
                select(FirewallLog).where(
                    or_(
                        FirewallLog.host_name.like("U6-LR-%"),
                        FirewallLog.host_name.like("USW-%"),
                        FirewallLog.raw_message.ilike("%Ubiquiti%"),
                        FirewallLog.raw_message.ilike("%U6-LR%"),
                        FirewallLog.raw_message.ilike("%USW-%"),
                    )
                )
            )
        ).all()

        updated = 0
        with_source_ip = 0
        with_destination_ip = 0
        with_destination_port = 0

        for row in rows:
            parsed = parse_syslog_message(row.raw_message, "Europe/Rome")
            changed = False
            for field in FIELDS:
                new_value = parsed.get(field)
                if getattr(row, field) != new_value:
                    setattr(row, field, new_value)
                    changed = True
            updated += int(changed)
            with_source_ip += int(bool(parsed.get("source_ip")))
            with_destination_ip += int(bool(parsed.get("destination_ip")))
            with_destination_port += int(bool(parsed.get("destination_port")))

        await session.commit()
        print(
            {
                "rows": len(rows),
                "updated": updated,
                "with_source_ip": with_source_ip,
                "with_destination_ip": with_destination_ip,
                "with_destination_port": with_destination_port,
            }
        )


if __name__ == "__main__":
    asyncio.run(main())
