from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import get_settings
from app.db.init_db import init_db
from app.services.enrichment import GeoEnrichmentWorker
from app.services.ingestion import IngestionService

settings = get_settings()
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    enrichment = GeoEnrichmentWorker()
    await enrichment.start()
    ingestion = IngestionService(enrichment)
    await ingestion.start()
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
    return FileResponse(STATIC_DIR / "index.html")
