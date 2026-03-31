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
- Frontend: SPA statica con Alpine.js, Tailwind CSS dark mode, ECharts e Leaflet
- AI: proxy streaming verso Ollama locale su `192.168.1.14:11434`
