from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_nginx_websocket_proxy_exposes_live_socket_routes() -> None:
    nginx_conf = (ROOT / "nginx" / "nginx.conf").read_text(encoding="utf-8")

    assert "location = /ws/live" in nginx_conf
    assert "location = /api/ws/live" in nginx_conf
    assert "proxy_http_version 1.1" in nginx_conf
    assert 'proxy_set_header Connection $connection_upgrade;' in nginx_conf
