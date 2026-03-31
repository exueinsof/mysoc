Sei un Expert Full-Stack Developer e Cybersecurity Engineer. Il tuo compito è creare un'applicazione web completa, asincrona e locale per l'analisi forense dei log del firewall pfSense. L'applicazione integrerà funzionalità di analisi potenziate da LLM locali (tramite Ollama esitente sulla macchina 192.168.1.14:11434).

## ARCHITETTURA TECNICA RICHIESTA
Tutto deve utilizzare librerie, codice, e framework opensource
Crea un docker compose con dei container dove far girare l'applicazione e i suoi servizi accessori,  testando prima il codice nell'ambiente /home/user/.pyenv/versions/3.11.10/bin/python senza dover ricostruire continuamente i container dell'app ( elacinado attivi quelli a serivzio come ad esmepio il db postgres o nginx per il reversy proxy)
- **Proxy** di ingresso per esporre tutti i servizi attrasverso la sola porta 9999, in maniera dinamica cosi che ovunque inserirò i container partiranno con indirizzi relativi rispetto all'ip dell'host o il suo nome
- **Backend:** Python 3.11.10,basato su `FastAPI` (completamente asincrono).
- **Database:** postgres con postgis e timescaledb (crea un container ed un db chiamato mysoc, accessibile solo dalla lan docker dell'applicazione non da tutti) (tramite aiosqlite/SQLAlchemy asincrono) per l'archiviazione efficiente delle time-series e query analitiche veloci.
- **Frontend:** HTML5, CSS3 (utilizza Tailwind CSS configurato in "Dark Mode") e un framework leggero e flessibile (come React.js o Alpine.js).
- **Stile UI:** "Dark style", ultramoderno, elegante, professionale (colori predominanti: sfondi grigio scuro/nero, testi grigio chiaro, accenti neon per blocchi/allarmi come rosso crimisi, ciano o verde smeraldo).

## MODULI BACKEND (Task Asincroni)
Il backend deve eseguire task asincroni concorrenti:
1. **Syslog Ingestion Task (Listener UDP):**
   - Un server UDP asincrono in ascolto sulla porta 514.
   - Deve parsare i log pfSense in tempo reale.
   - **Logica di Parsing (Cruciale):** Devi prendere spunto dalla logica originale di Logstash che troverai nella directory nel file logstash.conf.    
   - Classificare il traffico  IP sorgente/destinazione e definire un tab di configurazione in cui si possono definire delle etichetet sulle subnet tipo ad esmepio: le seguenti subnet come interne: "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", altre se non dichiarate saranno esterne per default. Questo permetterà di poer fare classificaiozne anche del tipo traffico: `internal_lateral`, `internal_to_external`, `external_to_internal`, o `external_to_external`.
   - Salvare i record formattati nel Database asincronamente (per performance).
2. **GeoIP & Enrichment Task:** - Utilizzare una libreria Python (es. `geoip2` e il database MaxMind gratuito) per arricchire in background gli IP esterni con le coordinate geografiche (Lat/Lon).
3. **Web Server Task:**
   - FastAPI che serve i file statici del frontend e offre API RESTful/WebSocket per interrogare i log, alimentare i grafici e comunicare con Ollama.

## STRUTTURA FRONTEND (Single Page Application a 4 Tab)
L'interfaccia deve avere una navbar/sidebar elegante per navigare tra i Tab principali e una barra stato in basso:

1. **Tab 1: Timeline Analitica (Stile "Spartito Musicale")**
   - Usa la libreria `vis-timeline` o `Apache ECharts`.
   - Asse X: Tempo (zoomabile e scorrevole dal vivo).
   - Asse Y: Tracce orizzontali parallele separate per Categoria (es. IP Sorgente, Porta di destinazione o Tipologia di evento).
   - I log sono rappresentati come nodi su queste tracce. Colori diversi per eventi (es. Rosso=Block Inbound, Verde=Pass Outbound). Cliccando su un nodo si apre una modale (offcanvas) con tutti i dettagli del pacchetto grezzo.

2. **Tab 2: Classificazioni e Allarmi**
   - Tabelle dinamiche (es. DataTables o grid CSS custom) che raggruppano gli eventi.
   - Visualizzazione dei "Top 10 Blocked IPs", "Top Destination Ports", "Top Talker", "Top traffic flow", ecc. definibili anche da schermata grafica a runtime
   - Interfaccia per definire e visualizzare soglie (es. "Seleziona alert se IP X tenta > 50 connessioni in 1 minuto").

3. **Tab 3: Geomappa e Grafo di Rete**
   - Sezione divisa in due:
     - **Mappa (Leaflet.js):** Mappa del mondo scura (dark tile layer) con heatmap o marker luminosi che indicano da dove provengono i tentativi di accesso `external_to_internal`.
     - **Grafo (Cytoscape.js o ECharts Graph):** Rappresentazione a grafo orientato. Nodi = Host (IP) (sorgente e destinazione) e Servizi (Porte) (sorgente e destianzione) . Archi = Connessioni. Mostra visivamente chi sta parlando con chi nella rete.

4. **Tab 4: Analisi Forense AI (LLM)**
   - Interfaccia chat/pannello operativo.
   - L'utente seleziona una finestra temporale (es. "Ultimi 15 minuti") e una o più categorie di eventi 
   - Il backend estrae i log dal DB, genera un prompt testuale compatto (es. "Sei un analista cyber e forense. Analizza questi log e dimmi se ci sono anomalie, restituendomi anche un report dettalgiato") e fa una POST request locale a Ollama (`http://192.168.1.14:11434/api/generate`). Supporta il parsing in streaming della risposta per un effetto "typing" nella UI.

## ISTRUZIONI DI ESECUZIONE PER TE (AGENTE AI)
- **Step 1:** Scrivi lo schema del Database e il codice del Backend FastAPI completo per l'ingestion UDP (parser syslog/CSV) asincrono.
- **Step 2:** Scrivi le rotte API per servire i dati aggregati alla dashboard (Timeline, Mappa, Grafo) e per fare il proxy delle richieste a Ollama.
- **Step 3:** Scrivi UI  della struttura principale e dei Tab
- **Step 4:** Scrivi il codice per integrare vis-timeline, Leaflet, Cytoscape/ECharts e la comunicazione API.
- **Step 4:** Scrivi il codice per il tab LLM 
- **Step 5:** Finalizza tutti i servizi, funzioni, test anche con playwright, seciurezza, resilienza,
- **Step 6:** se tutto è funzionante crea il docker compose finale con tutti i container compreso quello della apèplicaizone mysoc e lancia tutto
