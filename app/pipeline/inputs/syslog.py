import asyncio


class SyslogProtocol(asyncio.DatagramProtocol):
    def __init__(self, queue: asyncio.Queue[str]) -> None:
        self.queue = queue

    def datagram_received(self, data: bytes, addr) -> None:
        del addr
        try:
            message = data.decode("utf-8", errors="replace")
        except Exception:
            return
        self.queue.put_nowait(message)
