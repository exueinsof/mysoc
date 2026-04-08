# mysoc

Piattaforma locale per l'analisi forense dei log pfSense con FastAPI asincrono, PostgreSQL/TimescaleDB/PostGIS, UI dark SPA e integrazione Ollama.

## Avvio locale

```bash
cp .env.example .env
./scripts/dev.sh
```

## Stack

- Backend: FastAPI async, SQLAlchemy 2 async, parser syslog/CSV compatibile con `logstash.conf`
- Ingestion: listener UDP porta `514`, batching asincrono e worker GeoIP
- Database: PostgreSQL `mysoc` con estensioni TimescaleDB e PostGIS
- Frontend: SPA statica dark con Alpine.js, Tailwind CSS, ECharts e Leaflet; aggiornamenti realtime via WebSocket
- AI: proxy streaming verso Ollama locale su `192.168.1.14:11434`

## Stato migrazione frontend

- realtime live attivo su `WS /api/ws/live` (push incrementale dei nuovi log/eventi)
- polling classico mantenuto solo come fallback
- piano completo di migrazione a React disponibile in `REACT_MIGRATION_PLAN.md`
- preview React servita in parallelo su `/react` con adapter unico `fetch + WebSocket`

### Avvio preview React

```bash
cd frontend
npm install
npm run build
```

Poi apri `http://localhost:9999/react` (oppure `http://localhost:8000/react` se usi Uvicorn diretto).

## Frontend React migrato per slice

La nuova shell React copre già i pannelli a basso rischio:

- `Overview` → health, GeoIP status, top cards
- `Logs` → tabella con filtri e prepend realtime
- `Config` → subnets, alerts, scopes e metrics runtime

Timeline, geomappa/grafo e AI restano disponibili nella UI legacy mentre la migrazione continua.

## Backend ingestion pipeline

La pipeline di ingestione è ora separata in moduli dedicati:

- `app/pipeline/inputs/` → ingressi UDP/syslog
- `app/pipeline/processors/` → parse + classify + trasformazioni batch
- `app/pipeline/outputs/` → persistenza DB, enrichment dispatch, publish realtime

`app/services/ingestion.py` resta l’orchestratore lifecycle-aware, senza accorpare più tutta la logica di trasformazione e output.
