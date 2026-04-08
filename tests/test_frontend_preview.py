from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import index, react_preview


def build_preview_app() -> FastAPI:
    app = FastAPI()
    app.get("/")(index)
    app.get("/react")(react_preview)
    app.get("/react/{full_path:path}")(react_preview)
    return app


def test_root_route_prefers_react_dashboard_shell() -> None:
    with TestClient(build_preview_app()) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert '<div id="root">' in response.text
    assert "mysoc React dashboard" in response.text


def test_legacy_route_is_not_exposed_anymore() -> None:
    with TestClient(build_preview_app()) as client:
        response = client.get("/legacy")

    assert response.status_code == 404


def test_react_preview_route_serves_html_shell() -> None:
    with TestClient(build_preview_app()) as client:
        response = client.get("/react")
        nested_response = client.get("/react/logs")

    assert response.status_code == 200
    assert nested_response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert '<div id="root">' in response.text
    assert "mysoc React dashboard" in response.text
