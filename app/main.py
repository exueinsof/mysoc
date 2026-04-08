from contextlib import asynccontextmanager
from ipaddress import ip_address
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import get_settings
from app.db.init_db import init_db
from app.services.enrichment import GeoEnrichmentWorker
from app.services.ingestion import IngestionService
from app.services.realtime import RealtimeHub

settings = get_settings()
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
REACT_STATIC_DIR = STATIC_DIR / "react"


def _request_client_allowed(request: Request) -> bool:
    client_host = request.client.host if request.client else None
    if not client_host or client_host in {"127.0.0.1", "::1", "localhost", "testclient"}:
        return True
    try:
        return ip_address(client_host).is_private
    except ValueError:
        return True


def _react_preview_fallback() -> HTMLResponse:
    return HTMLResponse(
        """
        <!DOCTYPE html>
        <html lang="it">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>mysoc React dashboard</title>
            <style>
              body { margin: 0; font-family: Inter, Arial, sans-serif; background: #070b11; color: #e2e8f0; }
              main { max-width: 860px; margin: 0 auto; padding: 48px 20px; }
              .card { background: #101722; border: 1px solid #223042; border-radius: 20px; padding: 24px; }
              a { color: #22d3ee; }
              code { background: rgba(34, 211, 238, 0.12); padding: 2px 6px; border-radius: 6px; }
            </style>
          </head>
          <body>
            <main>
              <div id="root">
                <section class="card">
                  <h1>mysoc React dashboard</h1>
                  <p>La UI primaria è React; se il bundle non è ancora disponibile in questa istanza, puoi rigenerarlo o usare il fallback storico.</p>
                  <p>Esegui <code>npm --prefix frontend install && npm --prefix frontend run build</code> per generare la dashboard React di produzione.</p>
                </section>
              </div>
            </main>
          </body>
        </html>
        """.strip()
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    realtime = RealtimeHub()
    enrichment = GeoEnrichmentWorker()
    await enrichment.start()
    ingestion = IngestionService(enrichment, realtime_hub=realtime)
    await ingestion.start()
    app.state.realtime = realtime
    app.state.enrichment = enrichment
    app.state.ingestion = ingestion
    try:
        yield
    finally:
        await ingestion.stop()
        await enrichment.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.include_router(router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
async def index():
    index_path = REACT_STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return _react_preview_fallback()


@app.get("/react", include_in_schema=False)
@app.get("/react/{full_path:path}", include_in_schema=False)
async def react_preview(request: Request, full_path: str = ""):
    if not _request_client_allowed(request):
        raise HTTPException(status_code=403, detail="React preview limited to local/private clients")

    index_path = REACT_STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return _react_preview_fallback()
