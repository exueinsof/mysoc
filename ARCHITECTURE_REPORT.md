# ARCHITECTURE REPORT

## 1. Obiettivo del sistema

`mysoc` e' una piattaforma locale per analisi forense dei log pfSense progettata per:
- ricevere log firewall via syslog UDP in tempo reale
- parsarli secondo la logica del `logstash.conf` fornito
- classificarli per direzione e tipologia del traffico
- archiviarli in PostgreSQL/TimescaleDB
- arricchirli con geolocalizzazione IP city-level
- esporli in una SPA locale tramite FastAPI
- inviare dataset contestualizzati a un LLM locale via Ollama

## 2. Architettura applicativa

### 2.1 Backend FastAPI

Il backend vive nel package `app/` ed e' completamente asincrono.

- `app/main.py`
  - inizializza FastAPI
  - monta gli asset statici del frontend
  - usa un `lifespan` asincrono per:
    - inizializzare DB e schema
    - avviare worker GeoIP
    - avviare listener UDP syslog

- `app/core/config.py`
  - centralizza la configurazione da `.env`
  - espone DB URL, porte, URL Ollama, path DB-IP Lite, timezone e parametri di download GeoIP

### 2.2 Parsing e ingestion

- `app/services/parser.py`
  - esegue parsing header syslog stile Logstash
  - estrae priority opzionale, timestamp, host, process name/pid e payload
  - se il processo e' `filterlog`, usa parsing CSV coerente con `logstash.conf`
  - normalizza:
    - `action`
    - `protocol`
    - IP e porte
    - `event_outcome`
    - `network_type`
    - `summary`

- `app/services/ingestion.py`
  - avvia server UDP asincrono su `514/udp`
  - accoda i datagrammi in `asyncio.Queue`
  - batcha i messaggi con:
    - `UDP_BATCH_SIZE`
    - `UDP_FLUSH_INTERVAL`
  - invoca parser e classificatore
  - persiste i log in `firewall_logs`
  - inoltra gli IP sorgente esterni al worker GeoIP

### 2.3 Classificazione del traffico

- `app/services/classifier.py`
  - valuta se source/destination IP appartengono a subnet interne configurate
  - assegna:
    - `internal_lateral`
    - `internal_to_external`
    - `external_to_internal`
    - `external_to_external`
  - valorizza anche `network_direction`

Le subnet sono persistite in `config_subnets` e gestibili da UI/API.

### 2.4 Enrichment GeoIP

- `app/services/enrichment.py`
  - usa DB-IP Lite city-level come database GeoIP locale finale
  - risolve automaticamente l’URL mensile corrente dalla pagina ufficiale DB-IP
  - scarica e decomprime `dbip-city-lite.mmdb`
  - mantiene cache su tabella `geoip_cache`
  - effettua reset cache e re-enrichment degli IP storici quando il provider viene riallineato
  - aggiorna i log su:
    - `source_country`
    - `source_city`
    - `source_lat`
    - `source_lon`
  - su PostgreSQL aggiorna anche `source_geo geography(POINT,4326)`

### 2.5 API REST e AI proxy

- `app/api/routes.py`
  - `GET /api/health`
  - `GET /api/system/geoip-status`
  - `GET /api/system/catalogs`
  - `GET /api/config/scopes`
  - `PUT /api/config/scopes`
  - `GET /api/config/metrics`
  - `PUT /api/config/metrics`
  - `GET /api/config/subnets`
  - `PUT /api/config/subnets`
  - `GET /api/config/alerts`
  - `PUT /api/config/alerts`
  - `GET /api/dashboard/timeline`
  - `GET /api/dashboard/top`
  - `GET /api/dashboard/ip-detail`
  - `GET /api/dashboard/logs`
  - `GET /api/dashboard/map`
  - `GET /api/dashboard/graph`
  - `GET /api/dashboard/alerts`
  - `POST /api/ai/analyze`

- `app/services/ollama.py`
  - gestisce lo streaming della risposta da Ollama
  - inoltra chunk testuali alla UI in tempo reale

## 3. Modello dati

### 3.1 Tabelle principali

- `firewall_logs`
  - archivio principale time-series
  - chiave primaria composta:
    - `id`
    - `observed_at`
  - contiene:
    - metadata syslog
    - action/protocol/interface/reason
    - source/destination ip/port
    - campi di classificazione
    - campi di enrichment
    - raw log

- `config_subnets`
  - subnet runtime configurabili
  - ogni subnet ha `name`, `cidr`, `scope`, `enabled`

- `scope_catalog`
  - catalogo persistente degli scope selezionabili dalla UI
  - disaccoppia la definizione scope dalle sole subnet esistenti

- `geoip_cache`
  - cache per enrichment IP

- `alert_thresholds`
  - soglie operative runtime
  - ogni allarme ha `name`, `metric`, `threshold`, `window_seconds`, `enabled`

- `metric_catalog`
  - catalogo persistente delle metriche selezionabili dalla UI
  - rende stabile la definizione di nuove metriche custom

### 3.2 Uso TimescaleDB/PostGIS

- `init_db()` esegue:
  - `CREATE EXTENSION IF NOT EXISTS postgis`
  - `CREATE EXTENSION IF NOT EXISTS timescaledb`
  - `create_hypertable('firewall_logs', 'observed_at', if_not_exists => TRUE)`
- `source_geo` e' mantenuta come `geography(POINT,4326)` su PostgreSQL

## 4. Frontend SPA

Il frontend e' statico, servito da FastAPI.

### 4.1 Stack UI

- HTML5 + CSS custom
- Tailwind CSS via CDN
- Alpine.js per stato e interazioni
- ECharts per timeline e geografo
- Leaflet per geomappa

### 4.2 Tab implementati

- Tab 1: Timeline
  - timeline analitica multi-traccia al centro
  - toolbar compatta sotto il grafico:
    - checkbox `Righe da graficare`
    - bottoni `Gruppi`
  - pannello destro dedicato a:
    - istante selezionato
    - evento selezionato
    - correlazioni vicino al cursore temporale
  - click sul punto timeline:
    - aggiorna il dettaglio a destra
    - non apre modale

- Tab 2: Classificazioni e Allarmi
  - top blocked IPs
  - top destination ports
  - top traffic flows
  - preview alert blocchi
  - catalogo scope persistente con aggiunta nuovi scope
  - catalogo metriche persistente con aggiunta nuove metriche
  - modali classe/allarme con menu selezionabili che riusano i cataloghi
  - preview JSON di scope, metriche, classi e allarmi
  - pannello dettaglio IP cliccabile dai riquadri top

- Tab 3: Geomappa e Geografo
  - mappa Leaflet con marker city-level reali da DB-IP Lite
  - default:
    - solo punti visibili
    - tooltip solo su hover
    - popup dettaglio su click
  - geografo ECharts host -> host -> servizio
  - filtri UI espliciti `source`, `destination`, `service`
  - redraw completo per evitare artefatti residui sul canvas

- Tab 4: Log
  - tabella completa dei log ingestiti
  - una riga per evento
  - colonna dettaglio con JSON completo del log

- Tab 5: Analisi AI
  - modello, finestra temporale e categorie traffico
  - tutte le categorie preselezionate all’avvio
  - bottone `Avvia analisi` in alto a destra del pannello
  - output streaming da Ollama

## 5. Struttura Docker

### 5.1 Servizi

- `proxy`
  - immagine `nginx:1.27-alpine`
  - espone la UI e le API
  - inoltra verso `app:8000`

- `app`
  - build locale da `Dockerfile`
  - esegue FastAPI, worker UDP e worker GeoIP
  - monta `./data/dbip` nel container

- `postgres`
  - immagine `timescale/timescaledb-ha:pg16`
  - DB `mysoc`
  - estensioni inizializzate da `docker/postgres/init.sql`

### 5.2 Network

- `edge`
  - rete bridge per proxy e publish UDP

- `backend`
  - rete bridge `internal: true`
  - isola DB e backend

Topologia finale:
- `app` collegata a `backend` e `edge`
- `proxy` collegato a `backend` e `edge`
- `postgres` collegato solo a `backend`

Questa topologia mantiene il DB isolato e rende corretta la publish UDP host -> container.

### 5.3 Porte

- `proxy`
  - host `:9999` -> container `:9999/tcp`

- `app`
  - host `:514/udp` -> container `:514/udp`
  - `8000/tcp` exposed solo internamente

- `postgres`
  - nessuna porta pubblicata su host

### 5.4 Health e resilienza

- PostgreSQL usa `healthcheck` con `pg_isready`
- `app` aspetta il DB con retry applicativo
- `proxy` dipende da `app`

## 6. Flusso end-to-end

1. pfSense invia syslog UDP a `host:514/udp`
2. Docker inoltra verso `mysoc-app`
3. `IngestionService` riceve, batcha e persiste i log
4. `GeoEnrichmentWorker` arricchisce gli IP esterni via DB-IP Lite
5. FastAPI espone timeline, top, map, graph, ip-detail, logs, cataloghi persistenti e AI
6. La SPA interroga le API e aggiorna i pannelli
7. L’analisi AI invia a Ollama log già arricchiti e contestualizzati

## 7. Verifiche eseguite

### 7.1 Locale Python

- `.venv/bin/pytest -q` -> `5 passed`
- `node --check app/static/js/app.js` -> ok
- `python3 -m compileall app` -> ok

### 7.2 Verifiche runtime Docker

- `docker compose up -d --build --force-recreate app proxy` -> riuscito
- `docker compose ps`:
  - `mysoc-postgres` healthy
  - `mysoc-app` up
  - `mysoc-proxy` up
- `curl http://127.0.0.1:9999/api/health` -> `{"status":"ok","service":"mysoc"}`
- `curl http://127.0.0.1:9999/api/system/geoip-status` -> provider `dbip-lite`, DB presente
- lookup MMDB dentro il container verificato
- ingestion UDP host -> container verificata
- `/api/dashboard/map` restituisce city-level reale, per esempio:
  - `1.1.1.1 -> Australia / Sydney`
  - `8.8.8.8 -> United States / Mountain View`
- `/api/dashboard/ip-detail` restituisce dettaglio IP completo
- `/api/system/catalogs` restituisce cataloghi persistenti `scope_catalog` e `metric_catalog`
- `/api/dashboard/logs` restituisce righe log complete per il tab `Log`

## 8. Note operative

- Il database GeoIP atteso e' `data/dbip/dbip-city-lite.mmdb`.
- Lo script host per scaricare/aggiornare il DB e' `scripts/download_dbip_lite.sh`.
- L’attribuzione DB-IP e' esposta nel footer UI come richiesto dalla licenza del dataset Lite.
- Il frontend resta volutamente buildless/CDN-based per velocizzare sviluppo e portabilita'.
- Se in futuro vuoi un layer operativo verso pfSense/OS per il modulo AI, il passo corretto e' un layer tool/MCP controllato, non accesso shell/API illimitato.
