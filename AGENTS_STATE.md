# AGENTS_STATE

## Stato corrente
- Fase attiva: in consolidamento finale.
- Stato: piattaforma implementata, funzionante e avviata in Docker sui target finali `:9999` e `:514/udp`; la timeline analitica e' stata reingegnerizzata con architettura overview/detail per dataset grandi ed e' ora operativa lato API e frontend ECharts.
- Provider GeoIP finale: `dbip-lite` con database city-level locale e download mensile automatico.
- UI allineata: timeline centrale con toolbar compatta, pannello destro di contesto, classificazioni estendibili, geomappa hover-first, geografo pulito, analisi AI con categorie tutte preselezionate.

## Obiettivi realizzati
- Backend FastAPI asincrono con parser pfSense e listener UDP.
- PostgreSQL/TimescaleDB/PostGIS integrato.
- SPA dark a 4 tab operative.
- GeoIP locale city-level senza dipendere da API esterne.
- Tracciamento stato persistente e report architetturale.

## Architettura implementata
- `proxy` Nginx pubblicato su `:9999` per UI e API.
- `app` FastAPI pubblicata su `:514/udp` per syslog pfSense.
- Parser syslog esteso anche a UniFi/Ubiquiti:
  - CEF `Activity Logging (Syslog)` del controller UniFi
  - log legacy device-level di Access Point e Switch (`hostapd`, `switch`, `mcad`, messaggi con tuple device UniFi)
- `postgres` TimescaleDB/PostGIS interno alla rete Docker `backend`.
- `app/main.py` inizializza DB, worker GeoIP DB-IP Lite e listener UDP via `lifespan`.
- `app/services/parser.py` implementa parsing syslog/pfSense `filterlog` aderente alla logica del `logstash.conf`.
- `app/services/classifier.py` classifica i flussi in base alle subnet configurate.
- `app/services/ingestion.py` gestisce batching UDP, parsing, classificazione e persistenza.
- `app/services/enrichment.py` gestisce download/refresh DB-IP Lite, cache GeoIP, re-enrichment storico e aggiornamento coordinate.
- `app/api/routes.py` espone health, dashboard, cataloghi scope/metriche, dettaglio IP e proxy AI/Ollama.
- `app/static/` contiene la SPA con Alpine.js, Tailwind CDN, ECharts per timeline e grafo rete, Leaflet per la mappa.

## Passi completati
- Letto `AGENTS.md`.
- Analizzato `logstash.conf`.
- Creato scaffold completo del progetto.
- Implementato backend asincrono, schema DB, parser pfSense, API dashboard e AI proxy.
- Implementata SPA con timeline, classificazioni, geomappa/geografo e analisi AI.
- Risolto il problema publish UDP host -> container collegando `app` sia a `backend` sia a `edge`.
- Risolto il regression bug `400 Bad Request` su timeline supportando `track_by=event`.
- Reso il refresh frontend resiliente con `Promise.allSettled()`.
- Migrato GeoIP da MaxMind/IPLocate a DB-IP Lite:
  - DB locale `data/dbip/dbip-city-lite.mmdb`
  - download mensile automatico
  - parsing city-level reale
  - cache GeoIP e re-enrichment dati storici
- Rifinita UX timeline:
  - KPI rimossi da tutte le schermate
  - grafico centrale pulito
  - toolbar compatta sotto il grafico
  - pannello destro solo per istante selezionato, evento selezionato e correlazioni
  - dettaglio evento nel pannello destro, senza modale
- Rifinita UX classificazioni:
  - catalogo scope persistente lato DB/API
  - catalogo metriche persistente lato DB/API
  - descrizione esplicita delle metriche realmente derivabili dai log
  - menu reali nei modali classe/allarme
  - JSON visibile di scope, metriche, classi e allarmi
  - insight IP cliccabili nei riquadri top con dettaglio spostato al centro al posto della preview alert
- Rifinita UX geomappa/geografo:
  - marker visibili di default
  - hint solo al passaggio mouse
  - popup dettaglio al click
  - filtri espliciti `source/destination/service` con stati attivo/disattivo piu' leggibili
  - redraw completo per evitare archi residui
  - colori nodo aggiornati:
    - `source` rosso chiaro
    - `destination` blu chiaro
    - `service` viola chiaro
- Rifinita UX analisi AI:
  - bottone `Avvia analisi` in alto a destra
  - bottone `Salva prompt`
  - libreria prompt salvati in localStorage con usa/modifica/elimina
  - tutte le categorie preselezionate
  - prompt default arricchito con dettagli geografici source e descrizione grafi source-destination
  - picker modelli popolato dinamicamente da Ollama locale con default `llama3.1:8b`
- Aggiunto tab `Log` con elenco tabellare completo dei log ingestiti e dettaglio JSON per riga.
- Aggiunti filtri incrementali per colonna nel tab `Log`.
- Aggiunta colonna `Classe` nel tab `Log` con classi associate agli IP source/destination del record.
- Modificato ranking classificazioni `Top destination port` -> `Top IP:Port destination`.
- Rifinito il layout responsive per schermi bassi con viewport `100dvh`, chart elastici e scroll interni ai pannelli.
- Rimossi residui non usati:
  - fetch frontend verso `dashboard/alerts`
  - endpoint backend `GET /api/dashboard/alerts`
  - stato frontend `mapConnectionOverlay`
  - `tests/__pycache__`
- Aggiunta suite Playwright in `tests/test_ui_playwright.py` per verificare regressioni di layout/tab.
- Backend grafo rete aggiornato con archi aggregati aggiuntivi `source -> port`, oltre a `source -> destination` e `destination -> port`, per rendere esplicita la relazione tra IP sorgente e servizio finale.
- Endpoint timeline aggiornato per restituire `min_time` e `max_time` coerenti con l'intervallo richiesto, non con tutto lo storico DB.
- Timeline reingegnerizzata per Big Data con architettura a due livelli:
  - overview aggregata su tutto l'intervallo scelto, con bucket temporali adattivi
  - drill-down automatico sulla finestra visibile, con eventi raw solo quando il range e' abbastanza stretto
  - renderer riportato su ECharts/Canvas per maggiore robustezza con grandi volumi
  - buffer client limitato ai dati della finestra visibile e massimo `50000` eventi raw
  - `Start date` / `End date` definiscono l'intervallo logico globale, non il dump completo nel browser
  - `dataZoom` ECharts pilota il caricamento dinamico del dettaglio
  - tutte le tracce timeline sono attive di default (`event`, `traffic_flow`, `source_ip`, `destination_ip`, `destination_port`, `action`)
  - la finestra iniziale ora coincide con l'intero intervallo richiesto, evitando di nascondere eventi storici come i log pfSense del giorno precedente
  - cursore mouse gestito con axisPointer nativo ECharts; linea persistente solo sul click, senza redraw completo ad ogni movimento

## Verifiche eseguite
- `node --check app/static/js/app.js` -> ok
- `python3 -m compileall app` -> ok
- `.venv/bin/pytest -q` -> `5 passed`
- `.venv/bin/pytest -q tests/test_ui_playwright.py tests/test_api.py tests/test_parser.py` -> `6 passed`
- `.venv/bin/pytest -q tests/test_api.py tests/test_parser.py tests/test_ui_playwright.py` -> `17 passed`
- `.venv/bin/pytest -q tests/test_api.py tests/test_parser.py` -> `17 passed`
- `.venv/bin/pytest -q tests/test_api.py tests/test_parser.py` dopo la nuova timeline overview/detail -> `19 passed`
- `docker compose up -d --build --force-recreate app proxy` -> ok
- `docker compose ps`:
  - `mysoc-proxy` up su `:9999`
  - `mysoc-app` up su `:514/udp`
  - `mysoc-postgres` healthy
- `curl http://127.0.0.1:9999/api/health` -> `{"status":"ok","service":"mysoc"}`
- `curl http://127.0.0.1:9999/api/system/geoip-status` -> provider `dbip-lite`, DB presente in `/app/data/dbip/dbip-city-lite.mmdb`
- `curl http://127.0.0.1:9999/api/system/catalogs` -> cataloghi persistenti scope/metriche disponibili
- `curl http://127.0.0.1:9999/api/system/catalogs` -> include anche `supported_alert_metrics`
- `curl http://127.0.0.1:9999/api/dashboard/logs?minutes=1440&limit=2` -> endpoint tabellare log disponibile
- test runtime DB-IP Lite:
  - lookup MMDB reale verificato per IP pubblici
  - arricchimento city-level verificato via `/api/dashboard/map`
  - dettaglio IP verificato via `/api/dashboard/ip-detail`
- test persistenza cataloghi:
  - aggiunta scope/metrica via API verificata
  - rilettura cataloghi dopo refresh verificata
  - restore finale allo stato pulito completato
- test ingestione UDP host -> container verificato con evento recuperato via API.
- verifica API post-riallineamento:
  - `/api/dashboard/graph?minutes=180` include archi `source -> port`
  - `POST /api/dashboard/timeline/overview` funziona in runtime su TimescaleDB/Postgres
  - `POST /api/dashboard/timeline/detail` funziona in runtime e restituisce eventi raw sulla finestra visibile
  - prova reale eseguita su stack Docker:
    - overview 24h -> `200`, `12` righe, `1016` punti aggregati, intervallo iniziale allineato a tutto il range richiesto
    - detail sulla finestra iniziale -> `200`, mode `events` o `aggregate` in base allo span visibile
  - verifica presenza pfSense:
    - `/api/dashboard/logs?minutes=10080&summary_filter=pfSense firewall` -> `6` record confermati
    - esempio presente: `2026-03-29T15:22:00+00:00 pfSense firewall block tcp 9.9.9.9:45678 -> 192.168.1.50:9443`
  - probe browser Playwright:
    - timeline caricata
    - istanza ECharts presente
    - primi 6 checkbox timeline tutti attivi

## Passi in corso
- Rifinitura UX della timeline nuova:
  - sostituiti `datetime-local` con picker grafici calendario/ora (`flatpickr`)
  - timeline ECharts rimossa e sostituita con renderer custom `canvas`
  - layout a spartito mantenuto: righe categoria, griglia temporale, nodi colorati, selezione AI, pan/zoom
  - overview inferiore dedicata per spostarsi sull'intervallo globale
  - geomappa aggiornata con pannello dedicato `country/city`, popup ad alto contrasto e mappa base piu' leggibile
  - grafo rete esteso con nodi `ip:porta` e archi diretti `source_ip:source_port -> destination_ip:destination_port`
  - aggiunta doppia vista grafo: `force` come default per esplorazione libera e `sankey` come alternativa
  - layout force reso piu' stabile: caching posizioni nodo e stop ai rimescolamenti inutili sui refresh
  - aggiunto toggle fullscreen del widget grafo per aumentare la leggibilita' su grafi densi
  - bootstrap/reset timeline allineati a `now` e `now - 60 minuti`, con picker flatpickr sincronizzati e leggibili
  - geomappa e grafo ora usano la stessa finestra temporale della timeline, con limiti server-side per evitare saturazione
  - geomappa supporta fetch piu' stretti sul viewport quando l'utente fa zoom/pan sulla mappa
  - ottimizzazione successiva applicata: stop all'auto-refresh del tab `Geomappa/Grafo`, riduzione cardinalita' default (`map 150`, `graph 120`) e rimozione dei refresh/layout non necessari che rallentavano l'interfaccia
  - bootstrap frontend alleggerito: al primo accesso vengono caricati solo `health`, `geoip-status` e timeline; classificazioni, geomappa/grafo, log e metadata AI sono ora lazy-load sui rispettivi tab
  - ulteriore ottimizzazione UX: il grafo rete viene renderizzato in idle callback al primo accesso del tab mappa; il tab `Log` parte con pagina iniziale da `50` record e fetch differito per evitare blocchi al click
  - ottimizzazione tab `Log`: il JSON di dettaglio non viene piu' renderizzato per ogni riga, ma solo on-demand tramite bottone `Dettagli`
  - geomappa: lo zoom/pan utente blocca l'autofit automatico, evitando il ritorno forzato alla vista iniziale
  - grafo rete: modalita' `force` con stato idle/freeze; il click congela il layout per l'esplorazione, dopo inattivita' riparte il moto del layout
  - log: query allineate alla stessa finestra temporale attiva della timeline e paginazione lazy `Indietro/Avanti`
  - log UX completata: navigazione pagina con prima/ultima, salti di 1 e 5 pagine, input pagina diretto e dettaglio riga apribile al click
  - fullscreen del grafo rete: la geomappa viene nascosta mentre il grafo e' espanso
  - AI semplificata: usa sempre la finestra temporale attiva della timeline o la selezione sulla timeline, senza picker minuti e senza categorie manuali
- Tutto il resto della piattaforma e' operativo:
  - ingestione pfSense e UniFi/Ubiquiti
  - classificazioni/allarmi
  - tab log con streaming paginato
  - geomappa
  - grafo rete
  - analisi AI

## Passi da fare
- Eventuale rifinitura visuale fine della timeline custom su densita' molto alte.
- Se richiesto, progettare un layer tool/MCP controllato per accesso operativo a OS e pfSense.

## Nota finale
- Stato reale da cui ripartire:
  - la nuova timeline overview/detail e' implementata e funziona lato API/runtime
  - il prossimo lavoro e' di rifinitura UX e validazione browser, non piu' di architettura di base
  - il file `AGENTS_STATE.md` e' allineato per ripartire senza perdere contesto

## Note operative
- Il repository iniziale conteneva solo `AGENTS.md` e `logstash.conf`.
- Il provider GeoIP atteso dal sistema ora e' `dbip-lite`; il DB locale e' `data/dbip/dbip-city-lite.mmdb`.
- Il download del DB e' gestibile anche da host con `scripts/download_dbip_lite.sh`.
- Il footer UI include l’attribuzione richiesta da DB-IP.
- Report architetturale aggiornato in `ARCHITECTURE_REPORT.md`.
