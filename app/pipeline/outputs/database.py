from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import FirewallLog


async def write_rows(rows: Sequence[FirewallLog], session_factory: async_sessionmaker[AsyncSession]) -> None:
    if not rows:
        return

    async with session_factory() as session:
        dialect_name = session.bind.dialect.name if session.bind is not None else ""
        if dialect_name == "sqlite":
            for row in rows:
                session.add(row)
                await session.flush()
        else:
            session.add_all(list(rows))
        await session.commit()
