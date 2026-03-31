function mysocApp() {
  const trafficFlowOptions = [
    { value: "internal_lateral", label: "internal_lateral" },
    { value: "internal_to_external", label: "internal_to_external" },
    { value: "external_to_internal", label: "external_to_internal" },
    { value: "external_to_external", label: "external_to_external" },
  ];

  const trackOptions = [
    { key: "event", label: "Eventi generali" },
    { key: "traffic_flow", label: "Traffic flow" },
    { key: "source_ip", label: "Source IP" },
    { key: "destination_ip", label: "Destination IP" },
    { key: "destination_port", label: "Destination port" },
    { key: "action", label: "Action" },
  ];

  return {
    tabs: [
      { id: "timeline", name: "Timeline", description: "Eventi in sequenza multi-traccia" },
      { id: "alerts", name: "Classificazioni", description: "Classi runtime e allarmi guidati" },
      { id: "map", name: "Geomappa/Grafo", description: "Overlay geografici e relazioni rete" },
      { id: "logs", name: "Log", description: "Tabella completa dei log ingestiti" },
      { id: "ai", name: "Analisi AI", description: "Prompt e streaming Ollama" },
    ],
    activeTab: "timeline",
    statusMessage: "Bootstrap in corso",
    statusFooter: "loading...",
    health: {},
    ollamaModels: ["llama3.1:8b"],
    geoipStatus: { provider: "dbip-lite", mmdb_exists: false, geocoded_events: 0, mmdb_path: "" },
    geoipStatusMessage: "Verifica GeoIP in corso",
    timelineEvents: [],
    timelineBounds: { min: null, max: null },
    timelineAbsoluteBounds: { min: null, max: null },
    timelineFilters: { start: "", end: "" },
    timelineWindowTotal: 0,
    timelineWindowLimit: 50000,
    timelineWindowTruncated: false,
    timelineRequestId: 0,
    timelineRows: [],
    timelineOverviewPoints: [],
    timelineDetailPoints: [],
    timelineOverviewMeta: [],
    timelineDetailMeta: [],
    timelineDetailMode: "aggregate",
    timelineDetailBucketLabel: "",
    timelineBucketLabel: "",
    timelineVisibleRange: { start: null, end: null },
    timelineChartReady: false,
    timelineLoading: false,
    timelineBufferCap: 50000,
    timelineTrackSelections: ["event", "traffic_flow", "source_ip", "destination_ip", "destination_port", "action"],
    timelineTrackOptions: trackOptions,
    timelineCollapsedGroups: ["source_ip", "destination_ip", "destination_port"],
    timelineMaxRowsPerGroup: 6,
    selectedEvent: null,
    correlationTime: "",
    correlatedEvents: [],
    timelineSelectionMode: false,
    timelineSelection: null,
    timelineSelectionDraft: null,
    timelineSelectionCustom: false,
    timelinePanDraft: null,
    timelineOverviewDrag: null,
    timelineAiModalOpen: false,
    timelineAiOutput: "",
    timelineAiBusy: false,
    topCards: [],
    selectedTopInsight: null,
    logs: { items: [], total: 0, offset: 0, limit: 50, has_more: true },
    logsPageInput: 1,
    expandedLogRows: [],
    logFilters: { time: "", flow: "", action: "", source: "", destination: "", classes: "", protocol: "", geo: "", summary: "", details: "" },
    logLoading: false,
    logFilterDebounce: null,
    subnets: [],
    alerts: [],
    catalogs: {
      subnet_scopes: ["internal", "external"],
      alert_metrics: ["blocked_connections_per_source_ip", "distinct_destination_ports_per_source_ip"],
      supported_alert_metrics: [],
    },
    newScopeDraft: "",
    newMetricDraft: "",
    subnetModalOpen: false,
    alertModalOpen: false,
    subnetForm: { id: null, name: "", cidr: "", scope: "internal", enabled: true },
    alertForm: { id: null, name: "", metric: "blocked_connections_per_source_ip", threshold: 50, window_seconds: 60, enabled: true },
    analysis: {
      model: "llama3.1:8b",
      prompt: "Sei un analista cyber e forense. Analizza i log selezionati, evidenzia pattern sospetti, priorita', impatti e suggerisci azioni operative. Per gli IP source dammi i dettagli geografici. Descrivi i grafi source-destination.",
      output: "",
    },
    savedPrompts: [],
    graphLegend: "Cliccando un nodo vedrai il suo ruolo nel flusso.",
    selectedGraphNode: null,
    selectedMapPoint: null,
    graphMode: "force",
    graphModeOptions: ["force", "sankey"],
    graphFilterOptions: ["source", "destination", "service"],
    graphCategoryFilters: ["source", "destination", "service"],
    graphFullscreen: false,
    graphRenderedSignature: "",
    graphNodePositions: {},
    graphFrozen: false,
    graphIdleResumeDelayMs: 5 * 60 * 1000,
    graphIdleResumeTimer: null,
    graphMotionTimer: null,
    alertsDataLoaded: false,
    mapDataLoaded: false,
    aiMetaLoaded: false,
    mapFetchDebounce: null,
    mapProgrammaticMove: false,
    mapViewportLocked: false,
    timelineChart: null,
    graphChart: null,
    map: null,
    markers: [],
    mapPoints: [],
    graphDataCache: { nodes: [], edges: [] },
    snappedTimeMs: null,
    timelinePinnedTimeMs: null,
    timelineOrderedTimes: [],
    timelineHitPoints: [],
    timelineLayout: null,
    timelineStartPicker: null,
    timelineEndPicker: null,

    async init() {
      this.loadSavedPrompts();
      this.setDefaultTimelineWindow();
      await this.refreshBootstrap();
      this.$nextTick(() => this.initTimelinePickers());
      this.$watch("logFilters", () => this.scheduleLogRefresh(), { deep: true });
      this.$watch("activeTab", () => this.scheduleVisualRefresh());
      window.addEventListener("resize", () => this.scheduleVisualRefresh());
      setInterval(() => {
        if (this.activeTab === "timeline" || this.activeTab === "map") {
          return;
        }
        this.refreshAll();
      }, 15000);
    },

    async refreshBootstrap() {
      this.statusMessage = "Bootstrap timeline";
      this.statusFooter = `ultimo refresh ${new Date().toLocaleTimeString("it-IT")}`;
      try {
        const [health, geoipStatus] = await Promise.all([
          this.fetchJson("/api/health"),
          this.fetchJson("/api/system/geoip-status"),
        ]);
        this.health = health;
        this.geoipStatus = geoipStatus;
        this.geoipStatusMessage = geoipStatus.mmdb_exists
          ? geoipStatus.geocoded_events
            ? `Database ${geoipStatus.provider || "GeoIP"} disponibile. Eventi geocodificati: ${geoipStatus.geocoded_events}.`
            : `Database ${geoipStatus.provider || "GeoIP"} disponibile ma ancora senza eventi geocodificati.`
          : `Database ${geoipStatus.provider || "GeoIP"} assente in ${geoipStatus.mmdb_path}. Il sistema tentera' di scaricare automaticamente il DB mensile DB-IP Lite.`;
        await this.refreshTimelineWindow();
        this.statusMessage = "Timeline pronta";
        this.scheduleVisualRefresh();
      } catch (error) {
        console.error(error);
        this.statusMessage = `Errore: ${error.message}`;
      }
    },

    async refreshAlertsData() {
      const [
        blocked,
        destinationSockets,
        flows,
        subnets,
        alertsConfig,
        catalogs,
      ] = await Promise.all([
        this.fetchJson("/api/dashboard/top?field=source_ip&minutes=1440&limit=10"),
        this.fetchJson("/api/dashboard/top?field=destination_socket&minutes=1440&limit=10"),
        this.fetchJson("/api/dashboard/top?field=traffic_flow&minutes=1440&limit=10"),
        this.fetchJson("/api/config/subnets"),
        this.fetchJson("/api/config/alerts"),
        this.fetchJson("/api/system/catalogs"),
      ]);
      this.subnets = subnets;
      this.alerts = alertsConfig;
      this.catalogs = catalogs;
      this.topCards = [
        { title: "Top Blocked IPs", detailType: "source_ip", items: blocked.items },
        { title: "Top IP:Port Destination", detailType: "none", items: destinationSockets.items },
        { title: "Top Traffic Flow", detailType: "none", items: flows.items },
      ];
      this.alertsDataLoaded = true;
    },

    async refreshAiMeta() {
      const ollamaModels = await this.fetchJson("/api/system/ollama-models");
      this.ollamaModels = ollamaModels.models?.length ? ollamaModels.models : ["llama3.1:8b"];
      if (!this.ollamaModels.includes(this.analysis.model)) {
        this.analysis.model = this.ollamaModels[0];
      }
      this.aiMetaLoaded = true;
    },

    setActiveTab(tabId) {
      this.activeTab = tabId;
      if (tabId === "map") {
        if (!this.mapDataLoaded) {
          this.refreshMapAndGraphData();
        }
        requestAnimationFrame(() => {
          this.renderMap(this.mapPoints);
          this.scheduleGraphRender();
        });
      }
      if (tabId === "alerts" && !this.alertsDataLoaded) {
        this.refreshAlertsData();
      }
      if (tabId === "logs" && !this.logs.items.length) {
        this.resetLogStream();
      }
      if (tabId === "ai" && !this.aiMetaLoaded) {
        this.refreshAiMeta();
      }
      if (tabId === "timeline" && !this.timelineEvents.length) {
        this.refreshTimelineWindow();
      }
      if (tabId === "timeline") {
        requestAnimationFrame(() => {
          this.syncTimelinePickers();
          if (this.timelineRows.length) {
            this.renderTimeline();
          }
        });
      }
      this.scheduleVisualRefresh();
    },

    async refreshAll() {
      this.statusMessage = "Sincronizzazione dati dashboard";
      this.statusFooter = `ultimo refresh ${new Date().toLocaleTimeString("it-IT")}`;
      try {
        this.health = await this.fetchJson("/api/health");
        const geoipStatus = await this.fetchJson("/api/system/geoip-status");
        this.geoipStatus = geoipStatus;
        this.geoipStatusMessage = geoipStatus.mmdb_exists
          ? geoipStatus.geocoded_events
            ? `Database ${geoipStatus.provider || "GeoIP"} disponibile. Eventi geocodificati: ${geoipStatus.geocoded_events}.`
            : `Database ${geoipStatus.provider || "GeoIP"} disponibile ma ancora senza eventi geocodificati.`
          : `Database ${geoipStatus.provider || "GeoIP"} assente in ${geoipStatus.mmdb_path}. Il sistema tentera' di scaricare automaticamente il DB mensile DB-IP Lite.`;
        await this.refreshTimelineWindow();
        if (this.activeTab === "alerts" || this.alertsDataLoaded) {
          await this.refreshAlertsData();
        }
        if (this.activeTab === "map") {
          await this.refreshMapAndGraphData();
        }
        if (this.activeTab === "logs") {
          await this.resetLogStream();
        }
        if (this.activeTab === "ai" || this.aiMetaLoaded) {
          await this.refreshAiMeta();
        }
        this.statusMessage = "Dashboard aggiornata";
        this.scheduleVisualRefresh();
      } catch (error) {
        console.error(error);
        this.statusMessage = `Errore: ${error.message}`;
      }
    },

    async fetchJson(url) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response.json();
    },

    setDefaultTimelineWindow() {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
      this.timelineFilters.end = this.toDateTimeLocal(now.toISOString());
      this.timelineFilters.start = this.toDateTimeLocal(oneHourAgo.toISOString());
      this.timelineSelection = {
        startMs: oneHourAgo.getTime(),
        endMs: now.getTime(),
        startIso: oneHourAgo.toISOString(),
        endIso: now.toISOString(),
      };
      // The default analysis window is active for data queries, but it should
      // not be drawn as a visual overlay until the user creates a manual range.
      this.timelineSelectionCustom = false;
    },

    dashboardTimeScopeParams(defaultMinutes = 60, extra = {}) {
      const params = new URLSearchParams();
      if (this.timelineSelection?.startIso && this.timelineSelection?.endIso) {
        params.set("start_time", this.timelineSelection.startIso);
        params.set("end_time", this.timelineSelection.endIso);
      } else {
        this.normalizeTimelineFilters();
        if (this.timelineFilters.start && this.timelineFilters.end) {
          params.set("start_time", new Date(this.timelineFilters.start).toISOString());
          params.set("end_time", new Date(this.timelineFilters.end).toISOString());
        } else {
          params.set("minutes", String(defaultMinutes));
        }
      }
      Object.entries(extra).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== "") {
          params.set(key, String(value));
        }
      });
      return params.toString();
    },

    async refreshMapAndGraphData({ mapOnly = false } = {}) {
      const mapExtra = { limit: 150 };
      if (this.map) {
        const zoom = this.map.getZoom();
        if (zoom >= 3) {
          const bounds = this.map.getBounds();
          mapExtra.north = bounds.getNorth();
          mapExtra.south = bounds.getSouth();
          mapExtra.east = bounds.getEast();
          mapExtra.west = bounds.getWest();
        }
      }
      const tasks = [
        this.fetchJson(`/api/dashboard/map?${this.dashboardTimeScopeParams(60, mapExtra)}`),
        mapOnly ? Promise.resolve(this.graphDataCache) : this.fetchJson(`/api/dashboard/graph?${this.dashboardTimeScopeParams(60, { limit: 120 })}`),
      ];
      const [mapResult, graphResult] = await Promise.allSettled(tasks);
      if (mapResult.status === "fulfilled") {
        this.mapPoints = mapResult.value.points || [];
      }
      if (graphResult.status === "fulfilled") {
        this.graphDataCache = graphResult.value;
      }
      this.mapDataLoaded = true;
      if (this.activeTab === "map") {
        this.renderMap(this.mapPoints);
        if (!mapOnly) {
          this.scheduleGraphRender();
        }
      }
    },

    scheduleGraphRender() {
      const run = () => this.renderGraph(this.graphDataCache);
      if (window.requestIdleCallback) {
        window.requestIdleCallback(run, { timeout: 250 });
      } else {
        setTimeout(run, 0);
      }
    },

    scheduleMapViewportFetch() {
      if (this.mapFetchDebounce) {
        clearTimeout(this.mapFetchDebounce);
      }
      this.mapFetchDebounce = setTimeout(() => {
        this.refreshMapAndGraphData({ mapOnly: true });
      }, 220);
    },

    async postJson(url, payload) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response.json();
    },

    buildTimelinePayload() {
      this.normalizeTimelineFilters();
      return {
        minutes: 10080,
        start_time: this.timelineFilters.start ? new Date(this.timelineFilters.start).toISOString() : null,
        end_time: this.timelineFilters.end ? new Date(this.timelineFilters.end).toISOString() : null,
        tracks: this.timelineTrackSelections,
        collapsed_groups: this.timelineCollapsedGroups,
        max_rows_per_group: this.timelineMaxRowsPerGroup,
      };
    },

    async refreshTimelineWindow() {
      const requestId = ++this.timelineRequestId;
      this.timelineLoading = true;
      const payload = await this.postJson("/api/dashboard/timeline/overview", this.buildTimelinePayload());
      if (requestId !== this.timelineRequestId) {
        return;
      }
      this.timelineRows = payload.rows || [];
      this.timelineOverviewPoints = payload.points || [];
      this.timelineBounds = { min: payload.requested_start || null, max: payload.requested_end || null };
      this.timelineAbsoluteBounds = { min: payload.absolute_min_time || null, max: payload.absolute_max_time || null };
      this.timelineBucketLabel = payload.bucket_label || "";
      this.timelineWindowLimit = payload.buffer_cap || this.timelineWindowLimit;
      this.timelineBufferCap = payload.buffer_cap || this.timelineBufferCap;
      this.timelineVisibleRange = {
        start: payload.initial_visible_start || payload.requested_start || null,
        end: payload.initial_visible_end || payload.requested_end || null,
      };
      this.timelineWindowTotal = payload.points?.length || 0;
      this.timelineWindowTruncated = false;
      this.ensureTimelineDateFilters();
      await this.loadTimelineDetailWindow(this.timelineVisibleRange.start, this.timelineVisibleRange.end, { render: false });
      this.renderTimeline();
      this.timelineLoading = false;
      this.syncTimelinePickers();
    },

    ensureTimelineDateFilters() {
      if (!this.timelineFilters.start) {
        const fallbackEnd = new Date();
        const fallbackStart = new Date(fallbackEnd.getTime() - (60 * 60 * 1000));
        this.timelineFilters.start = this.toDateTimeLocal(
          this.timelineAbsoluteBounds.min && new Date(this.timelineAbsoluteBounds.min) > fallbackStart
            ? this.timelineAbsoluteBounds.min
            : fallbackStart.toISOString(),
        );
      }
      if (!this.timelineFilters.end) {
        this.timelineFilters.end = this.toDateTimeLocal(new Date().toISOString());
      }
      this.syncTimelinePickers();
    },

    toDateTimeLocal(value) {
      if (!value) {
        return "";
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return "";
      }
      const pad = (n) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },

    nowDateTimeLocal() {
      return this.toDateTimeLocal(new Date().toISOString());
    },

    initTimelinePickers() {
      if (!window.flatpickr) {
        return;
      }
      const locale = window.flatpickr.l10ns?.it || "it";
      const sharedConfig = {
        enableTime: true,
        time_24hr: true,
        minuteIncrement: 1,
        dateFormat: "Y-m-d\\TH:i",
        altInput: true,
        altInputClass: "input-dark",
        altFormat: "d/m/Y H:i",
        locale,
        allowInput: false,
      };
      if (this.$refs.timelineStartPicker && !this.timelineStartPicker) {
        this.timelineStartPicker = window.flatpickr(this.$refs.timelineStartPicker, {
          ...sharedConfig,
          defaultDate: this.timelineFilters.start || null,
          onChange: (selectedDates) => {
            this.timelineFilters.start = selectedDates[0] ? this.toDateTimeLocal(selectedDates[0].toISOString()) : "";
          },
        });
      }
      if (this.$refs.timelineEndPicker && !this.timelineEndPicker) {
        this.timelineEndPicker = window.flatpickr(this.$refs.timelineEndPicker, {
          ...sharedConfig,
          defaultDate: this.timelineFilters.end || null,
          onChange: (selectedDates) => {
            this.timelineFilters.end = selectedDates[0] ? this.toDateTimeLocal(selectedDates[0].toISOString()) : "";
          },
        });
      }
      this.syncTimelinePickers();
    },

    syncTimelinePickers() {
      const minDate = this.timelineAbsoluteBounds.min ? new Date(this.timelineAbsoluteBounds.min) : null;
      const maxDate = new Date();
      if (this.timelineStartPicker) {
        this.timelineStartPicker.set("minDate", minDate);
        this.timelineStartPicker.set("maxDate", maxDate);
        this.timelineStartPicker.setDate(this.timelineFilters.start || null, false, "Y-m-d\\TH:i");
      }
      if (this.timelineEndPicker) {
        this.timelineEndPicker.set("minDate", minDate);
        this.timelineEndPicker.set("maxDate", maxDate);
        this.timelineEndPicker.setDate(this.timelineFilters.end || null, false, "Y-m-d\\TH:i");
      }
    },

    normalizeTimelineFilters() {
      if (!this.timelineFilters.start || !this.timelineFilters.end) {
        return;
      }
      const start = new Date(this.timelineFilters.start).getTime();
      const end = new Date(this.timelineFilters.end).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && start > end) {
        const currentStart = this.timelineFilters.start;
        this.timelineFilters.start = this.timelineFilters.end;
        this.timelineFilters.end = currentStart;
      }
    },

    async applyTimelineDateFilters() {
      this.normalizeTimelineFilters();
      this.timelineSelectionDraft = null;
      this.timelineVisibleRange = { start: null, end: null };
      this.timelinePinnedTimeMs = null;
      this.snappedTimeMs = null;
      this.selectedEvent = null;
      this.correlationTime = "";
      this.correlatedEvents = [];
      await this.refreshTimelineWindow();
    },

    async resetTimelineDateFilters() {
      this.setDefaultTimelineWindow();
      this.syncTimelinePickers();
      await this.applyTimelineDateFilters();
      await this.refreshMapAndGraphData();
    },

    toggleSelection(listName, value) {
      const current = this[listName];
      if (current.includes(value)) {
        this[listName] = current.filter((item) => item !== value);
      } else {
        this[listName] = [...current, value];
      }
      if (listName === "timelineTrackSelections") {
        this.refreshTimelineWindow();
      }
    },

    toggleTrackGroup(trackKey) {
      if (this.timelineCollapsedGroups.includes(trackKey)) {
        this.timelineCollapsedGroups = this.timelineCollapsedGroups.filter((item) => item !== trackKey);
      } else {
        this.timelineCollapsedGroups = [...this.timelineCollapsedGroups, trackKey];
      }
      this.refreshTimelineWindow();
    },

    isTrackGroupCollapsed(trackKey) {
      return this.timelineCollapsedGroups.includes(trackKey);
    },

    isSelected(listName, value) {
      return this[listName].includes(value);
    },

    toggleTimelineSelectionMode() {
      this.timelineSelectionMode = !this.timelineSelectionMode;
      this.timelineSelectionDraft = null;
      this.timelinePinnedTimeMs = null;
      this.statusMessage = this.timelineSelectionMode
        ? "Modalita' finestra timeline attiva: clicca un inizio e poi una fine sul grafico"
        : "Modalita' finestra timeline disattivata";
      this.renderTimeline();
    },

    clearTimelineSelection() {
      if (this.timelineFilters.start && this.timelineFilters.end) {
        const start = new Date(this.timelineFilters.start);
        const end = new Date(this.timelineFilters.end);
        this.timelineSelection = {
          startMs: start.getTime(),
          endMs: end.getTime(),
          startIso: start.toISOString(),
          endIso: end.toISOString(),
        };
      }
      this.timelineSelectionDraft = null;
      this.timelinePinnedTimeMs = null;
      this.timelineAiOutput = "";
      this.timelineSelectionMode = false;
      // Clearing returns the analysis scope to the current picker window and
      // hides the visual overlay until a new manual selection is created.
      this.timelineSelectionCustom = false;
      this.renderTimeline();
      this.statusMessage = "Finestra timeline cancellata";
      this.refreshMapAndGraphData();
    },

    timelineSelectionLabel() {
      if (!this.timelineSelectionCustom || !this.timelineSelection) {
        return "default ultimi 60 minuti";
      }
      return `${new Date(this.timelineSelection.startMs).toLocaleString("it-IT")} -> ${new Date(this.timelineSelection.endMs).toLocaleString("it-IT")}`;
    },

    analysisTimeScopeLabel() {
      if (this.timelineSelection) {
        return `${new Date(this.timelineSelection.startMs).toLocaleString("it-IT")} -> ${new Date(this.timelineSelection.endMs).toLocaleString("it-IT")}`;
      }
      return "ultimi 60 minuti";
    },

    async persistCatalogValue(target, rawValue, pickAfterSave = false) {
      const value = (rawValue || "").trim();
      if (!value) {
        return;
      }
      const current = this.catalogs[target] || [];
      const nextValues = current.includes(value) ? [...current] : [...current, value].sort();
      const url = target === "subnet_scopes" ? "/api/config/scopes" : "/api/config/metrics";
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextValues.map((name) => ({ name }))),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      this.catalogs[target] = nextValues;
      if (target === "subnet_scopes") {
        if (pickAfterSave) this.subnetForm.scope = value;
        this.newScopeDraft = "";
      }
      if (target === "alert_metrics") {
        if (pickAfterSave) this.alertForm.metric = value;
        this.newMetricDraft = "";
      }
      await this.refreshAll();
    },

    chooseCatalogValue(target, value) {
      if (target === "subnet_scopes") {
        this.subnetForm.scope = value;
      }
      if (target === "alert_metrics") {
        this.alertForm.metric = value;
      }
    },

    loadSavedPrompts() {
      try {
        this.savedPrompts = JSON.parse(window.localStorage.getItem("mysoc.savedPrompts") || "[]");
      } catch (_error) {
        this.savedPrompts = [];
      }
    },

    persistSavedPrompts() {
      window.localStorage.setItem("mysoc.savedPrompts", JSON.stringify(this.savedPrompts));
    },

    savePrompt() {
      const text = (this.analysis.prompt || "").trim();
      if (!text) {
        return;
      }
      const existing = this.savedPrompts.find((item) => item.text === text);
      if (existing) {
        this.applySavedPrompt(existing.id);
        return;
      }
      const suggestedName = `Prompt ${new Date().toLocaleString("it-IT")}`;
      const name = window.prompt("Nome del prompt", suggestedName);
      if (name === null) {
        return;
      }
      this.savedPrompts = [
        {
          id: `${Date.now()}`,
          name: name.trim() || suggestedName,
          text,
        },
        ...this.savedPrompts,
      ];
      this.persistSavedPrompts();
    },

    applySavedPrompt(promptId) {
      const prompt = this.savedPrompts.find((item) => item.id === promptId);
      if (!prompt) {
        return;
      }
      this.analysis.prompt = prompt.text;
    },

    editSavedPrompt(promptId) {
      const prompt = this.savedPrompts.find((item) => item.id === promptId);
      if (!prompt) {
        return;
      }
      const name = window.prompt("Nome del prompt", prompt.name);
      if (name === null) {
        return;
      }
      const text = window.prompt("Testo del prompt", prompt.text);
      if (text === null) {
        return;
      }
      this.savedPrompts = this.savedPrompts.map((item) => item.id === promptId ? { ...item, name: name.trim() || item.name, text: text.trim() || item.text } : item);
      this.persistSavedPrompts();
      this.applySavedPrompt(promptId);
    },

    deleteSavedPrompt(promptId) {
      this.savedPrompts = this.savedPrompts.filter((item) => item.id !== promptId);
      this.persistSavedPrompts();
    },

    filteredLogs() {
      return this.logs.items || [];
    },

    isLogExpanded(logId) {
      return this.expandedLogRows.includes(logId);
    },

    toggleLogExpanded(logId) {
      if (this.expandedLogRows.includes(logId)) {
        this.expandedLogRows = this.expandedLogRows.filter((item) => item !== logId);
      } else {
        this.expandedLogRows = [...this.expandedLogRows, logId];
      }
    },

    buildLogQuery(offset = 0) {
      const params = new URLSearchParams({
        limit: String(this.logs.limit || 50),
        offset: String(offset),
      });
      this.normalizeTimelineFilters();
      if (this.timelineFilters.start && this.timelineFilters.end) {
        params.set("start_time", new Date(this.timelineFilters.start).toISOString());
        params.set("end_time", new Date(this.timelineFilters.end).toISOString());
      } else {
        params.set("minutes", "60");
      }
      const mapping = {
        time: "time_filter",
        flow: "flow_filter",
        action: "action_filter",
        source: "source_filter",
        destination: "destination_filter",
        classes: "classes_filter",
        protocol: "protocol_filter",
        geo: "geo_filter",
        summary: "summary_filter",
      };
      Object.entries(mapping).forEach(([key, apiKey]) => {
        const value = String(this.logFilters[key] || "").trim();
        if (value) {
          params.set(apiKey, value);
        }
      });
      return params.toString();
    },

    scheduleLogRefresh() {
      clearTimeout(this.logFilterDebounce);
      this.logFilterDebounce = setTimeout(() => this.resetLogStream(), 250);
    },

    async resetLogStream() {
      this.logs = { items: [], total: 0, offset: 0, limit: this.logs.limit || 50, has_more: true };
      this.expandedLogRows = [];
      await this.loadLogPage(0);
    },

    async loadLogPage(offset = 0) {
      if (this.logLoading) {
        return;
      }
      this.logLoading = true;
      try {
        const payload = await this.fetchJson(`/api/dashboard/logs?${this.buildLogQuery(offset)}`);
        this.logs = {
          items: payload.items || [],
          total: payload.total || 0,
          offset: offset,
          limit: payload.limit || this.logs.limit,
          has_more: Boolean(payload.has_more),
        };
        this.logsPageInput = this.logCurrentPage();
      } finally {
        this.logLoading = false;
      }
    },

    async nextLogPage() {
      if (this.logLoading || !this.logs.has_more) {
        return;
      }
      await this.loadLogPage(this.logs.offset + this.logs.limit);
    },

    async previousLogPage() {
      if (this.logLoading) {
        return;
      }
      await this.loadLogPage(Math.max(0, this.logs.offset - this.logs.limit));
    },

    logCurrentPage() {
      return Math.floor((this.logs.offset || 0) / (this.logs.limit || 1)) + 1;
    },

    logTotalPages() {
      return Math.max(1, Math.ceil((this.logs.total || 0) / (this.logs.limit || 1)));
    },

    async goToFirstLogPage() {
      await this.loadLogPage(0);
    },

    async goToLastLogPage() {
      const totalPages = this.logTotalPages();
      await this.loadLogPage(Math.max(0, (totalPages - 1) * (this.logs.limit || 1)));
    },

    async jumpBackwardLogs() {
      await this.loadLogPage(Math.max(0, (this.logs.offset || 0) - ((this.logs.limit || 1) * 5)));
    },

    async jumpForwardLogs() {
      const lastOffset = Math.max(0, (this.logTotalPages() - 1) * (this.logs.limit || 1));
      await this.loadLogPage(Math.min(lastOffset, (this.logs.offset || 0) + ((this.logs.limit || 1) * 5)));
    },

    async goToLogPageInput() {
      const totalPages = this.logTotalPages();
      const page = Math.min(totalPages, Math.max(1, Number(this.logsPageInput || 1)));
      this.logsPageInput = page;
      await this.loadLogPage((page - 1) * (this.logs.limit || 1));
    },

    onLogScroll(event) {
      return event;
    },

    async loadTimelineDetailWindow(startIso, endIso, { render = true } = {}) {
      if (!startIso || !endIso || !this.timelineRows.length) {
        return;
      }
      const payload = await this.postJson("/api/dashboard/timeline/detail", {
        start_time: startIso,
        end_time: endIso,
        rows: this.timelineRows,
      });
      this.timelineDetailMode = payload.mode || "aggregate";
      this.timelineDetailBucketLabel = payload.bucket_label || "";
      this.timelineWindowTotal = payload.events_total || 0;
      this.timelineWindowTruncated = Boolean(payload.truncated);
      this.timelineEvents = (payload.events || []).slice(-this.timelineBufferCap);
      this.timelineDetailPoints = payload.points || [];
      this.timelineOrderedTimes = [
        ...new Set(
          (this.timelineDetailMode === "events" ? this.timelineEvents : this.timelineDetailPoints)
            .map((item) => new Date(item.time || item.bucket_time).getTime())
            .filter((value) => Number.isFinite(value))
        ),
      ].sort((a, b) => a - b);
      if (!this.selectedEvent && this.timelineEvents.length) {
        this.selectedEvent = this.timelineEvents[0];
      }
      if (this.timelineOrderedTimes.length) {
        this.snapTimelineCursor(new Date(this.timelineOrderedTimes[0]).toISOString(), this.timelineOrderedTimes);
      } else {
        this.correlationTime = "";
        this.correlatedEvents = [];
      }
      if (render) {
        this.renderTimeline();
      }
    },

    buildTimelineRowIndex() {
      return new Map(this.timelineRows.map((row, index) => [row.id, index]));
    },

    timelineOverviewSeriesData(rowIndexMap) {
      const meta = [];
      const data = this.timelineOverviewPoints
        .map((point) => {
          const rowIndex = rowIndexMap.get(point.row_id);
          if (rowIndex === undefined) {
            return null;
          }
          meta.push({
            rowId: point.row_id,
            rowLabel: point.row_label,
            trackKey: point.track_key,
            count: point.count,
          });
          return [point.bucket_time, rowIndex, point.count, meta.length - 1];
        })
        .filter(Boolean);
      this.timelineOverviewMeta = meta;
      return data;
    },

    timelineDetailSeriesData(rowIndexMap) {
      if (this.timelineDetailMode === "events") {
        const meta = [];
        const data = this.timelineRows.flatMap((row) => {
          const rowIndex = rowIndexMap.get(row.id);
          return this.timelineEvents
            .filter((event) => this.timelineEventMatchesRow(event, row))
            .map((event) => {
              meta.push({
                rowId: row.id,
                rowLabel: row.label,
                trackKey: row.track_key,
                event,
              });
              return [event.time, rowIndex, 1, meta.length - 1];
            });
        });
        this.timelineDetailMeta = meta;
        return data;
      }
      const meta = [];
      const data = this.timelineDetailPoints
        .map((point) => {
          const rowIndex = rowIndexMap.get(point.row_id);
          if (rowIndex === undefined) {
            return null;
          }
          meta.push({
            rowId: point.row_id,
            rowLabel: point.row_label,
            trackKey: point.track_key,
            count: point.count,
          });
          return [point.bucket_time, rowIndex, point.count, meta.length - 1];
        })
        .filter(Boolean);
      this.timelineDetailMeta = meta;
      return data;
    },

    timelineEventMatchesRow(event, row) {
      if (row.aggregated || row.track_key === "event") {
        return true;
      }
      const value = this.trackValue(row.track_key, event);
      return `${value}` === `${row.value}`;
    },

    timelinePointMeta(params) {
      const metaIndex = params?.data?.[3];
      if (!Number.isInteger(metaIndex)) {
        return null;
      }
      if (params.seriesId === "timeline-overview") {
        return this.timelineOverviewMeta[metaIndex] || null;
      }
      if (params.seriesId === "timeline-detail") {
        return this.timelineDetailMeta[metaIndex] || null;
      }
      return null;
    },

    renderTimeline() {
      const mainCanvas = document.getElementById("timelineMainCanvas");
      const overviewCanvas = document.getElementById("timelineOverviewCanvas");
      if (!mainCanvas || !overviewCanvas) {
        return;
      }
      this.initTimelineCanvasHandlers();
      const rowIndexMap = this.buildTimelineRowIndex();
      const overviewData = this.timelineOverviewSeriesData(rowIndexMap);
      const detailData = this.timelineDetailSeriesData(rowIndexMap);
      const globalStartMs = new Date(this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const globalEndMs = new Date(this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      const visibleStartMs = new Date(this.timelineVisibleRange.start || this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const visibleEndMs = new Date(this.timelineVisibleRange.end || this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      this.resizeTimelineCanvas(mainCanvas);
      this.resizeTimelineCanvas(overviewCanvas);
      this.timelineLayout = this.timelineBuildLayout(mainCanvas);
      this.timelineHitPoints = [];

      const ctx = mainCanvas.getContext("2d");
      const { width, height, plotLeft, plotTop, plotWidth, plotHeight, rowHeight } = this.timelineLayout;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#081018";
      ctx.fillRect(0, 0, width, height);

      if (!this.timelineRows.length || !Number.isFinite(globalStartMs) || !Number.isFinite(globalEndMs)) {
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "14px IBM Plex Sans, Segoe UI, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Nessun evento disponibile per la timeline", width / 2, height / 2);
        this.renderTimelineOverview([]);
        return;
      }

      this.drawTimelineGrid(ctx, visibleStartMs, visibleEndMs);
      this.drawTimelineRows(ctx, rowHeight);
      this.drawTimelineOverviewPoints(ctx, overviewData, visibleStartMs, visibleEndMs);
      this.drawTimelineDetailPoints(ctx, detailData, visibleStartMs, visibleEndMs, rowHeight);
      this.drawTimelineSelection(ctx, visibleStartMs, visibleEndMs, plotTop, plotHeight);
      this.drawTimelinePinnedCursor(ctx, visibleStartMs, visibleEndMs, plotTop, plotHeight);
      this.renderTimelineOverview(overviewData);
      this.timelineChartReady = true;
    },

    initTimelineCanvasHandlers() {
      if (this.timelineChartReady) {
        return;
      }
      const mainCanvas = document.getElementById("timelineMainCanvas");
      const overviewCanvas = document.getElementById("timelineOverviewCanvas");
      if (!mainCanvas || !overviewCanvas) {
        return;
      }
      mainCanvas.addEventListener("mousedown", (event) => this.handleTimelinePointerDown(event));
      window.addEventListener("mousemove", (event) => this.handleTimelinePointerMove(event));
      window.addEventListener("mouseup", (event) => this.handleTimelinePointerUp(event));
      mainCanvas.addEventListener("click", (event) => this.handleTimelineClick(event));
      mainCanvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        this.handleTimelineWheel(event);
      }, { passive: false });
      overviewCanvas.addEventListener("mousedown", (event) => this.handleTimelineOverviewDown(event));
      window.addEventListener("mousemove", (event) => this.handleTimelineOverviewMove(event));
      window.addEventListener("mouseup", () => {
        this.timelineOverviewDrag = null;
      });
      overviewCanvas.addEventListener("click", (event) => this.handleTimelineOverviewClick(event));
    },

    resizeTimelineCanvas(canvas) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextHeight = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    timelineBuildLayout(canvas) {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const plotLeft = 176;
      const plotTop = 22;
      const plotRight = 22;
      const plotBottom = 26;
      const plotWidth = Math.max(80, width - plotLeft - plotRight);
      const plotHeight = Math.max(80, height - plotTop - plotBottom);
      const rowHeight = plotHeight / Math.max(1, this.timelineRows.length);
      return { width, height, plotLeft, plotTop, plotWidth, plotHeight, plotBottom, rowHeight };
    },

    drawTimelineGrid(ctx, visibleStartMs, visibleEndMs) {
      const { width, plotLeft, plotTop, plotWidth, plotHeight } = this.timelineLayout;
      const ticks = 8;
      ctx.strokeStyle = "rgba(148,163,184,0.12)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= ticks; i += 1) {
        const x = plotLeft + (plotWidth * (i / ticks));
        ctx.beginPath();
        ctx.moveTo(x, plotTop);
        ctx.lineTo(x, plotTop + plotHeight);
        ctx.stroke();
        const timeMs = visibleStartMs + ((visibleEndMs - visibleStartMs) * (i / ticks));
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "12px IBM Plex Sans, Segoe UI, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(new Date(timeMs).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }), x, this.timelineLayout.height - 8);
      }
      ctx.strokeStyle = "rgba(148,163,184,0.18)";
      ctx.beginPath();
      ctx.moveTo(plotLeft, plotTop + plotHeight);
      ctx.lineTo(width - 20, plotTop + plotHeight);
      ctx.stroke();
    },

    drawTimelineRows(ctx, rowHeight) {
      const { plotLeft, plotTop, plotWidth } = this.timelineLayout;
      const maxLabelWidth = Math.max(56, plotLeft - 28);
      this.timelineRows.forEach((row, index) => {
        const y = plotTop + (index * rowHeight);
        ctx.strokeStyle = "rgba(148,163,184,0.1)";
        ctx.beginPath();
        ctx.moveTo(plotLeft, y + rowHeight);
        ctx.lineTo(plotLeft + plotWidth, y + rowHeight);
        ctx.stroke();
        ctx.fillStyle = "#f8fafc";
        ctx.font = "13px IBM Plex Sans, Segoe UI, sans-serif";
        ctx.textAlign = "right";
        let label = row.label || "";
        if (ctx.measureText(label).width > maxLabelWidth) {
          while (label.length > 1 && ctx.measureText(`${label}...`).width > maxLabelWidth) {
            label = label.slice(0, -1);
          }
          label = `${label}...`;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(12, y, maxLabelWidth + 8, rowHeight);
        ctx.clip();
        ctx.fillText(label, plotLeft - 12, y + (rowHeight * 0.62));
        ctx.restore();
      });
    },

    drawTimelineOverviewPoints(ctx, points, visibleStartMs, visibleEndMs) {
      points.forEach((point) => {
        const timeMs = new Date(point[0]).getTime();
        if (timeMs < visibleStartMs || timeMs > visibleEndMs) {
          return;
        }
        const x = this.timelinePixelFromTimeMs(timeMs);
        const y = this.timelineRowCenter(point[1]);
        const radius = Math.max(2.5, Math.min(7, 2 + Math.log2((point[2] || 1) + 1)));
        ctx.beginPath();
        ctx.fillStyle = "rgba(148,163,184,0.28)";
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    },

    drawTimelineDetailPoints(ctx, points, visibleStartMs, visibleEndMs) {
      points.forEach((point) => {
        const timeMs = new Date(point[0]).getTime();
        if (timeMs < visibleStartMs || timeMs > visibleEndMs) {
          return;
        }
        const x = this.timelinePixelFromTimeMs(timeMs);
        const y = this.timelineRowCenter(point[1]);
        const meta = this.timelineDetailMeta[point[3]];
        const radius = this.timelineDetailMode === "events"
          ? 5
          : Math.max(4, Math.min(10, 3 + Math.log2((point[2] || 1) + 1)));
        const color = meta?.event ? this.trackColor(meta.trackKey, meta.event) : "#22d3ee";
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.shadowBlur = 18;
        ctx.shadowColor = color;
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        this.timelineHitPoints.push({ x, y, radius: Math.max(8, radius + 4), meta, timeMs });
      });
    },

    drawTimelineSelection(ctx, visibleStartMs, visibleEndMs, plotTop, plotHeight) {
      const range = this.timelineSelectionDraft
        ? {
            startMs: new Date(this.timelineAxisValueFromPixel(this.timelineSelectionDraft.anchorPx) || visibleStartMs).getTime(),
            endMs: new Date(this.timelineAxisValueFromPixel(this.timelineSelectionDraft.currentPx) || visibleEndMs).getTime(),
          }
        : this.timelineSelection && this.timelineSelectionCustom
          ? { startMs: this.timelineSelection.startMs, endMs: this.timelineSelection.endMs }
          : null;
      if (!range || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) {
        return;
      }
      const left = this.timelinePixelFromTimeMs(Math.min(range.startMs, range.endMs));
      const right = this.timelinePixelFromTimeMs(Math.max(range.startMs, range.endMs));
      ctx.fillStyle = "rgba(34,211,238,0.12)";
      ctx.fillRect(left, plotTop, Math.max(2, right - left), plotHeight);
      ctx.strokeStyle = "rgba(34,211,238,0.46)";
      ctx.strokeRect(left, plotTop, Math.max(2, right - left), plotHeight);
    },

    drawTimelinePinnedCursor(ctx, visibleStartMs, visibleEndMs, plotTop, plotHeight) {
      const pinnedMs = Number.isFinite(this.timelinePinnedTimeMs) ? this.timelinePinnedTimeMs : this.snappedTimeMs;
      if (!Number.isFinite(pinnedMs) || pinnedMs < visibleStartMs || pinnedMs > visibleEndMs) {
        return;
      }
      const x = this.timelinePixelFromTimeMs(pinnedMs);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotTop + plotHeight);
      ctx.stroke();
    },

    renderTimelineOverview(points) {
      const canvas = document.getElementById("timelineOverviewCanvas");
      if (!canvas) {
        return;
      }
      const ctx = canvas.getContext("2d");
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = "rgba(2,6,23,0.78)";
      ctx.fillRect(0, 0, rect.width, rect.height);
      const globalStartMs = new Date(this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const globalEndMs = new Date(this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      if (!Number.isFinite(globalStartMs) || !Number.isFinite(globalEndMs) || globalEndMs <= globalStartMs) {
        return;
      }
      const padding = 12;
      const width = Math.max(1, rect.width - (padding * 2));
      const height = rect.height - 20;
      const maxCount = Math.max(1, ...points.map((point) => point[2] || 0));
      points.forEach((point) => {
        const timeMs = new Date(point[0]).getTime();
        const ratio = (timeMs - globalStartMs) / (globalEndMs - globalStartMs);
        const x = padding + (ratio * width);
        const barHeight = Math.max(3, ((point[2] || 0) / maxCount) * (height - 10));
        ctx.fillStyle = "rgba(34,211,238,0.32)";
        ctx.fillRect(x, rect.height - 8 - barHeight, 2, barHeight);
      });
      const visibleStartMs = new Date(this.timelineVisibleRange.start || this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const visibleEndMs = new Date(this.timelineVisibleRange.end || this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      const left = padding + (((visibleStartMs - globalStartMs) / (globalEndMs - globalStartMs)) * width);
      const right = padding + (((visibleEndMs - globalStartMs) / (globalEndMs - globalStartMs)) * width);
      ctx.fillStyle = "rgba(34,211,238,0.14)";
      ctx.fillRect(left, 6, Math.max(4, right - left), rect.height - 12);
      ctx.strokeStyle = "rgba(34,211,238,0.7)";
      ctx.strokeRect(left, 6, Math.max(4, right - left), rect.height - 12);
    },

    handleTimelinePointerDown(event) {
      const pos = this.timelineCanvasPosition(event);
      if (!pos.inPlot) {
        return;
      }
      if (this.timelineSelectionMode) {
        return;
      }
      const startMs = new Date(this.timelineVisibleRange.start || this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const endMs = new Date(this.timelineVisibleRange.end || this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      const anchorValueMs = this.timelineTimeFromPixel(pos.x);
      if (!Number.isFinite(anchorValueMs)) {
        return;
      }
      this.timelinePanDraft = { anchorValueMs, startMs, endMs };
    },

    handleTimelinePointerMove(event) {
      const pos = this.timelineCanvasPosition(event);
      if (!pos) {
        return;
      }
      if (this.timelineSelectionMode && this.timelineSelectionDraft) {
        this.timelineSelectionDraft.currentPx = pos.x;
        this.renderTimeline();
        return;
      }
      if (this.timelinePanDraft) {
        this.panTimelineToPixel(pos.x);
        return;
      }
      if (!pos.inPlot) {
        return;
      }
      const timeMs = this.timelineTimeFromPixel(pos.x);
      if (Number.isFinite(timeMs)) {
        this.snapTimelineCursor(new Date(timeMs).toISOString(), this.timelineOrderedTimes);
        this.renderTimeline();
      }
    },

    handleTimelinePointerUp(event) {
      const pos = this.timelineCanvasPosition(event);
      if (this.timelinePanDraft) {
        if (pos) {
          this.panTimelineToPixel(pos.x);
        }
        this.timelinePanDraft = null;
        this.loadTimelineDetailWindow(this.timelineVisibleRange.start, this.timelineVisibleRange.end);
        return;
      }
    },

    handleTimelineClick(event) {
      const pos = this.timelineCanvasPosition(event);
      if (!pos?.inPlot || this.timelinePanDraft) {
        return;
      }
      if (this.timelineSelectionMode) {
        const clickedMs = this.timelineTimeFromPixel(pos.x);
        if (!Number.isFinite(clickedMs)) {
          return;
        }
        if (!this.timelineSelectionDraft) {
          this.timelineSelectionDraft = { anchorPx: pos.x, currentPx: pos.x };
          this.timelinePinnedTimeMs = clickedMs;
          this.statusMessage = "Inizio finestra timeline fissato: scegli il punto finale";
          this.renderTimeline();
          return;
        }
        this.timelineSelectionDraft.currentPx = pos.x;
        const startMs = this.timelineTimeFromPixel(this.timelineSelectionDraft.anchorPx);
        const endMs = this.timelineTimeFromPixel(this.timelineSelectionDraft.currentPx);
        this.timelineSelectionDraft = null;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || Math.abs(endMs - startMs) < 1000) {
          this.renderTimeline();
          return;
        }
        this.timelineSelection = {
          startMs: Math.min(startMs, endMs),
          endMs: Math.max(startMs, endMs),
          startIso: new Date(Math.min(startMs, endMs)).toISOString(),
          endIso: new Date(Math.max(startMs, endMs)).toISOString(),
        };
        this.timelineSelectionCustom = true;
        this.timelinePinnedTimeMs = Math.min(startMs, endMs);
        this.timelineSelectionMode = false;
        this.statusMessage = `Finestra timeline selezionata: ${this.timelineSelectionLabel()}`;
        this.refreshMapAndGraphData();
        this.renderTimeline();
        return;
      }
      const hit = this.timelineHitPoints.find((item) => Math.hypot(item.x - pos.x, item.y - pos.y) <= item.radius);
      if (hit?.meta?.event) {
        this.selectEvent(hit.meta.event);
        this.timelinePinnedTimeMs = hit.timeMs;
        this.updateCorrelations(hit.timeMs);
      } else {
        const timeMs = this.timelineTimeFromPixel(pos.x);
        if (Number.isFinite(timeMs)) {
          this.snapTimelineCursor(new Date(timeMs).toISOString(), this.timelineOrderedTimes, { pin: true });
        }
      }
      this.renderTimeline();
    },

    handleTimelineWheel(event) {
      const pos = this.timelineCanvasPosition(event);
      if (!pos?.inPlot) {
        return;
      }
      this.zoomTimelineAtPixel(pos.x, event.deltaY < 0 ? 1 : -1);
    },

    handleTimelineOverviewDown(event) {
      const rect = event.currentTarget.getBoundingClientRect();
      this.timelineOverviewDrag = { rect };
      this.handleTimelineOverviewClick(event);
    },

    handleTimelineOverviewMove(event) {
      if (!this.timelineOverviewDrag) {
        return;
      }
      this.handleTimelineOverviewClick(event, this.timelineOverviewDrag.rect);
    },

    handleTimelineOverviewClick(event, forcedRect = null) {
      const canvas = document.getElementById("timelineOverviewCanvas");
      const rect = forcedRect || canvas?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const x = Math.max(12, Math.min(rect.width - 12, event.clientX - rect.left));
      const globalStartMs = new Date(this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const globalEndMs = new Date(this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      const spanMs = new Date(this.timelineVisibleRange.end || this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime()
        - new Date(this.timelineVisibleRange.start || this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const ratio = (x - 12) / Math.max(1, rect.width - 24);
      const centerMs = globalStartMs + ((globalEndMs - globalStartMs) * ratio);
      let nextStartMs = centerMs - (spanMs / 2);
      let nextEndMs = centerMs + (spanMs / 2);
      if (nextStartMs < globalStartMs) {
        nextStartMs = globalStartMs;
        nextEndMs = globalStartMs + spanMs;
      }
      if (nextEndMs > globalEndMs) {
        nextEndMs = globalEndMs;
        nextStartMs = globalEndMs - spanMs;
      }
      this.timelineVisibleRange = {
        start: new Date(nextStartMs).toISOString(),
        end: new Date(nextEndMs).toISOString(),
      };
      this.renderTimeline();
      clearTimeout(this._timelineOverviewFetchDebounce);
      this._timelineOverviewFetchDebounce = setTimeout(() => {
        this.loadTimelineDetailWindow(this.timelineVisibleRange.start, this.timelineVisibleRange.end);
      }, 120);
    },

    timelineCanvasPosition(event) {
      const canvas = document.getElementById("timelineMainCanvas");
      if (!canvas || !this.timelineLayout) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inPlot = x >= this.timelineLayout.plotLeft
        && x <= this.timelineLayout.plotLeft + this.timelineLayout.plotWidth
        && y >= this.timelineLayout.plotTop
        && y <= this.timelineLayout.plotTop + this.timelineLayout.plotHeight;
      return { x, y, inPlot };
    },

    timelineTimeFromPixel(pixelX) {
      if (!this.timelineLayout) {
        return NaN;
      }
      const visibleStartMs = new Date(this.timelineVisibleRange.start || this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const visibleEndMs = new Date(this.timelineVisibleRange.end || this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      const clampedX = Math.max(this.timelineLayout.plotLeft, Math.min(this.timelineLayout.plotLeft + this.timelineLayout.plotWidth, pixelX));
      const ratio = (clampedX - this.timelineLayout.plotLeft) / Math.max(1, this.timelineLayout.plotWidth);
      return visibleStartMs + ((visibleEndMs - visibleStartMs) * ratio);
    },

    timelinePixelFromTimeMs(timeMs) {
      if (!this.timelineLayout) {
        return 0;
      }
      const visibleStartMs = new Date(this.timelineVisibleRange.start || this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const visibleEndMs = new Date(this.timelineVisibleRange.end || this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      const ratio = (timeMs - visibleStartMs) / Math.max(1, (visibleEndMs - visibleStartMs));
      return this.timelineLayout.plotLeft + (ratio * this.timelineLayout.plotWidth);
    },

    timelineRowCenter(rowIndex) {
      return this.timelineLayout.plotTop + (rowIndex * this.timelineLayout.rowHeight) + (this.timelineLayout.rowHeight / 2);
    },

    panTimelineToPixel(pixelX) {
      if (!this.timelinePanDraft) {
        return;
      }
      const currentValueMs = this.timelineTimeFromPixel(pixelX);
      const deltaMs = currentValueMs - this.timelinePanDraft.anchorValueMs;
      const globalStartMs = new Date(this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const globalEndMs = new Date(this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      const spanMs = this.timelinePanDraft.endMs - this.timelinePanDraft.startMs;
      let nextStartMs = this.timelinePanDraft.startMs - deltaMs;
      let nextEndMs = this.timelinePanDraft.endMs - deltaMs;
      if (nextStartMs < globalStartMs) {
        nextStartMs = globalStartMs;
        nextEndMs = globalStartMs + spanMs;
      }
      if (nextEndMs > globalEndMs) {
        nextEndMs = globalEndMs;
        nextStartMs = globalEndMs - spanMs;
      }
      this.timelineVisibleRange = {
        start: new Date(nextStartMs).toISOString(),
        end: new Date(nextEndMs).toISOString(),
      };
      this.renderTimeline();
    },

    zoomTimelineAtPixel(pixelX, direction) {
      const globalStartMs = new Date(this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const globalEndMs = new Date(this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      const visibleStartMs = new Date(this.timelineVisibleRange.start || this.timelineBounds.min || this.timelineAbsoluteBounds.min).getTime();
      const visibleEndMs = new Date(this.timelineVisibleRange.end || this.timelineBounds.max || this.timelineAbsoluteBounds.max).getTime();
      const anchorMs = this.timelineTimeFromPixel(pixelX);
      const spanMs = visibleEndMs - visibleStartMs;
      const factor = direction > 0 ? 0.8 : 1.25;
      const nextSpanMs = Math.max(30 * 1000, Math.min(globalEndMs - globalStartMs, spanMs * factor));
      const ratio = (anchorMs - visibleStartMs) / Math.max(1, spanMs);
      let nextStartMs = anchorMs - (nextSpanMs * ratio);
      let nextEndMs = nextStartMs + nextSpanMs;
      if (nextStartMs < globalStartMs) {
        nextStartMs = globalStartMs;
        nextEndMs = globalStartMs + nextSpanMs;
      }
      if (nextEndMs > globalEndMs) {
        nextEndMs = globalEndMs;
        nextStartMs = globalEndMs - nextSpanMs;
      }
      this.timelineVisibleRange = {
        start: new Date(nextStartMs).toISOString(),
        end: new Date(nextEndMs).toISOString(),
      };
      this.renderTimeline();
      clearTimeout(this._timelineZoomFetchDebounce);
      this._timelineZoomFetchDebounce = setTimeout(() => {
        this.loadTimelineDetailWindow(this.timelineVisibleRange.start, this.timelineVisibleRange.end);
      }, 120);
    },

    trackValue(trackKey, event) {
      if (trackKey === "event") return event.summary || "Evento";
      if (trackKey === "traffic_flow") return event.traffic_flow || "n/a";
      if (trackKey === "source_ip") return event.source_ip || "n/a";
      if (trackKey === "destination_ip") return event.destination_ip || "n/a";
      if (trackKey === "destination_port") return event.destination_port || "n/a";
      if (trackKey === "action") return event.action || "n/a";
      return "n/a";
    },

    trackColor(trackKey, event) {
      if (trackKey === "traffic_flow") {
        return {
          internal_lateral: "#22d3ee",
          internal_to_external: "#34d399",
          external_to_internal: "#ef4444",
          external_to_external: "#f59e0b",
        }[event.traffic_flow] || "#94a3b8";
      }
      if (trackKey === "action") {
        return event.action === "block" ? "#ef4444" : "#34d399";
      }
      return "#f8fafc";
    },

    timelineAxisValueFromPixel(offsetX) {
      if (!this.timelineLayout) {
        return null;
      }
      const timeMs = this.timelineTimeFromPixel(offsetX);
      if (!Number.isFinite(timeMs)) {
        return null;
      }
      return new Date(timeMs).toISOString();
    },

    snapTimelineCursor(axisValue, orderedTimes, { pin = false, rerender = false } = {}) {
      if (!axisValue || !orderedTimes.length) {
        return;
      }
      const targetMs = new Date(axisValue).getTime();
      let snapped = orderedTimes[0];
      let delta = Math.abs(snapped - targetMs);
      orderedTimes.forEach((timeMs) => {
        const currentDelta = Math.abs(timeMs - targetMs);
        if (currentDelta < delta) {
          snapped = timeMs;
          delta = currentDelta;
        }
      });
      if (this.snappedTimeMs === snapped && (!pin || this.timelinePinnedTimeMs === snapped)) {
        return;
      }
      this.snappedTimeMs = snapped;
      if (pin) {
        this.timelinePinnedTimeMs = snapped;
      }
      if (rerender) {
        this.renderTimeline();
      }
      this.updateCorrelations(snapped);
    },

    updateTimelineOverlay() {
      this.renderTimeline();
    },

    timelinePixelFromAxisValue(axisValue) {
      if (!axisValue) {
        return null;
      }
      const pixel = this.timelinePixelFromTimeMs(new Date(axisValue).getTime());
      return Number.isFinite(pixel) ? pixel : null;
    },

    updateCorrelations(axisValue) {
      if (!axisValue) {
        this.correlationTime = "";
        this.correlatedEvents = [];
        return;
      }
      const pivotTime = typeof axisValue === "number" ? axisValue : new Date(axisValue).getTime();
      this.correlationTime = new Date(pivotTime).toLocaleString("it-IT");
      this.correlatedEvents = this.timelineEvents
        .filter((event) => Math.abs(new Date(event.time).getTime() - pivotTime) <= 30000)
        .slice(0, 12);
    },

    selectEvent(event) {
      this.selectedEvent = event;
    },

    async openTopInsight(card, item) {
      const looksLikeIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(item?.value || "");
      if ((!card?.detailType || card.detailType !== "source_ip") && !looksLikeIp) {
        return;
      }
      this.selectedTopInsight = await this.fetchJson(`/api/dashboard/ip-detail?ip=${encodeURIComponent(item.value)}&minutes=1440`);
    },

    renderMap(points) {
      if (this.activeTab !== "map") {
        return;
      }
      if (!this.map) {
        this.map = L.map("worldMap", { zoomControl: true }).setView([22, 10], 2);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap",
        }).addTo(this.map);
        this.map.on("moveend zoomend", () => {
          if (this.mapProgrammaticMove) {
            return;
          }
          this.mapViewportLocked = true;
          this.scheduleMapViewportFetch();
        });
      }
      this.markers.forEach((marker) => marker.remove());
      this.markers = [];
      this.selectedMapPoint = points[0] || null;

      points.forEach((point) => {
        const marker = L.circleMarker([point.lat, point.lon], {
          radius: Math.min(20, 8 + Math.max(0, point.count - 1)),
          color: "#f8fafc",
          fillColor: "#ef4444",
          weight: 2.8,
          fillOpacity: 0.96,
        })
          .bindPopup(
            `${point.source_ip}:${point.source_port || "na"}<br>` +
            `${point.destination_ip}:${point.destination_port || "na"}<br>` +
            `country: ${point.country || "n/a"}<br>` +
            `city: ${point.city || "n/a"}<br>` +
            `count: ${point.count}`,
          )
          .addTo(this.map);

        marker.on("mouseover", () => {
          this.selectedMapPoint = point;
        });
        marker.on("click", () => {
          this.selectedMapPoint = point;
        });
        marker.bindTooltip(
          `${point.source_ip}:${point.source_port || "na"} -> ${point.destination_ip}:${point.destination_port || "na"} | ${point.country || "n/a"} / ${point.city || "n/a"}`,
          { permanent: false, sticky: true, direction: "top", className: "map-label", opacity: 0.9 },
        );
        marker.bringToFront();
        this.markers.push(marker);
      });

      requestAnimationFrame(() => {
        if (this.map) {
          this.map.invalidateSize(false);
        }
      });

      const keepViewport = this.mapViewportLocked;
      if (this.markers.length && !keepViewport) {
        const group = L.featureGroup(this.markers);
        this.mapProgrammaticMove = true;
        this.map.fitBounds(group.getBounds().pad(0.25), { maxZoom: 5 });
        setTimeout(() => { this.mapProgrammaticMove = false; }, 260);
      } else if (!this.markers.length && !keepViewport) {
        this.mapProgrammaticMove = true;
        this.map.setView([22, 10], 2);
        setTimeout(() => { this.mapProgrammaticMove = false; }, 260);
      }
    },

    graphSignature(graphData, filteredNodes, filteredEdges) {
      const nodePart = filteredNodes.map((node) => `${node.id}:${node.category}:${node.kind || "-"}`).join("|");
      const edgePart = filteredEdges.map((edge) => `${edge.source}>${edge.target}:${edge.value || 1}`).join("|");
      return `${this.graphMode}::${[...this.graphCategoryFilters].sort().join(",")}::${graphData.nodes.length}:${graphData.edges.length}::${nodePart}::${edgePart}`;
    },

    renderGraph(graphData) {
      if (this.activeTab !== "map") {
        return;
      }
      const el = document.getElementById("graphChart");
      if (!this.graphChart) {
        this.graphChart = echarts.init(el);
        this.graphChart.on("click", (params) => {
          this.freezeGraphMotion();
          const node = params.data;
          const categoryName = typeof node.category === "string"
            ? node.category
            : ["source", "destination", "service"][node.category] || "nodo";
          this.selectedGraphNode = {
            name: node.name,
            category: categoryName,
            explanation: this.graphExplanation(categoryName, node.name),
          };
        });
        // Persist node positions after the force layout converges or after manual drag.
        this.graphChart.on("finished", () => {
          if (this.graphMode !== "force") {
            return;
          }
          const option = this.graphChart.getOption();
          const series = option?.series?.[0];
          const data = series?.data || [];
          const nextPositions = {};
          data.forEach((node) => {
            if (node.id && Number.isFinite(node.x) && Number.isFinite(node.y)) {
              nextPositions[node.id] = { x: node.x, y: node.y };
            }
          });
          if (Object.keys(nextPositions).length) {
            this.graphNodePositions = nextPositions;
          }
        });
        this.graphChart.getZr().on("click", (params) => {
          if (!params.target) {
            this.freezeGraphMotion();
          }
        });
      }
      const categories = [{ name: "source" }, { name: "destination" }, { name: "service" }];
      // Filter categories before drawing so ECharts never leaves stale edges on the canvas.
      const allowed = new Set(this.graphCategoryFilters);
      const filteredNodes = graphData.nodes.filter((node) => allowed.has(node.category));
      const nodeIds = new Set(filteredNodes.map((node) => node.id));
      const filteredEdges = graphData.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
      const signature = this.graphSignature(graphData, filteredNodes, filteredEdges);
      if (signature === this.graphRenderedSignature) {
        this.graphChart.resize();
        return;
      }
      const nodes = filteredNodes.map((node) => {
        const hasPinnedPosition = Number.isFinite(this.graphNodePositions[node.id]?.x) && Number.isFinite(this.graphNodePositions[node.id]?.y);
        return {
        ...node,
        category: categories.findIndex((item) => item.name === node.category),
        x: this.graphNodePositions[node.id]?.x,
        y: this.graphNodePositions[node.id]?.y,
        fixed: this.graphMode === "force" ? (this.graphFrozen && hasPinnedPosition) : false,
        itemStyle: {
          color: node.kind === "source_socket"
            ? "#f5c2c7"
            : node.kind === "destination_socket"
              ? "#d8b4fe"
              : node.category === "service"
                ? "#c4b5fd"
                : undefined,
        },
        symbolSize: node.category === "service" ? 26 : 34,
      }});
      this.graphChart.clear();
      if (!nodes.length) {
        this.graphChart.setOption({
          backgroundColor: "#f8fafc",
          title: {
            text: "Nessun dato di grafo disponibile nella finestra selezionata",
            left: "center",
            top: "middle",
            textStyle: { color: "#334155", fontFamily: "IBM Plex Sans, Segoe UI, sans-serif", fontSize: 14 },
          },
          series: [],
        }, true);
        this.graphRenderedSignature = signature;
        return;
      }
      const sharedText = { fontFamily: "IBM Plex Sans, Segoe UI, sans-serif", fontSize: 14 };
      const sharedLabel = { show: true, color: "#0f172a", fontSize: 14, backgroundColor: "rgba(255,255,255,0.94)", padding: [2, 5], borderRadius: 6, borderColor: "rgba(15,23,42,0.18)", borderWidth: 1 };
      const sharedItemStyle = {
        color: (params) => params.data.itemStyle?.color || ["#fca5a5", "#93c5fd", "#c4b5fd"][params.data.category] || "#94a3b8",
        borderColor: "#0f172a",
        borderWidth: 1.4,
        shadowBlur: 12,
        shadowColor: "rgba(15,23,42,0.18)",
      };
      this.graphChart.setOption({
        backgroundColor: "#f8fafc",
        textStyle: sharedText,
        series: this.graphMode === "sankey"
          ? [
              {
                type: "sankey",
                data: nodes.map((node) => ({ ...node, depth: node.category })),
                links: filteredEdges,
                emphasis: { focus: "adjacency" },
                lineStyle: { color: "gradient", curveness: 0.42, opacity: 0.45 },
                label: { color: "#0f172a", fontSize: 14 },
                itemStyle: sharedItemStyle,
                nodeGap: 18,
                nodeWidth: 18,
                draggable: true,
              },
            ]
          : [
              {
                type: "graph",
                layout: "force",
                roam: true,
                draggable: !this.graphFrozen,
                animation: !this.graphFrozen,
                data: nodes,
                links: filteredEdges,
                categories,
                force: { repulsion: 170, edgeLength: [70, 140], layoutAnimation: !this.graphFrozen, gravity: 0.05, friction: 0.2 },
                lineStyle: { color: "rgba(15,23,42,0.42)", curveness: 0.16, opacity: 0.9, width: 1.8 },
                label: sharedLabel,
                itemStyle: sharedItemStyle,
              },
            ],
      }, true);
      this.graphRenderedSignature = signature;
      this.graphChart.resize();
      this.scheduleGraphMotion();
    },

    setGraphMode(mode) {
      this.graphMode = mode;
      this.selectedGraphNode = null;
      this.graphRenderedSignature = "";
      this.graphFrozen = false;
      this.renderGraph(this.graphDataCache);
    },

    toggleGraphCategory(value) {
      if (this.graphCategoryFilters.includes(value)) {
        this.graphCategoryFilters = this.graphCategoryFilters.filter((item) => item !== value);
      } else {
        this.graphCategoryFilters = [...this.graphCategoryFilters, value];
      }
      this.selectedGraphNode = null;
      this.graphRenderedSignature = "";
      this.renderGraph(this.graphDataCache);
    },

    toggleGraphFullscreen() {
      this.graphFullscreen = !this.graphFullscreen;
      this.$nextTick(() => {
        if (this.graphChart) {
          this.graphChart.resize();
        }
      });
    },

    freezeGraphMotion() {
      if (this.graphMode !== "force") {
        return;
      }
      if (this.graphChart) {
        const option = this.graphChart.getOption();
        const series = option?.series?.[0];
        const data = series?.data || [];
        const nextPositions = {};
        data.forEach((node) => {
          if (node.id && Number.isFinite(node.x) && Number.isFinite(node.y)) {
            nextPositions[node.id] = { x: node.x, y: node.y };
          }
        });
        if (Object.keys(nextPositions).length) {
          this.graphNodePositions = nextPositions;
        }
      }
      this.graphFrozen = true;
      if (this.graphMotionTimer) {
        clearTimeout(this.graphMotionTimer);
        this.graphMotionTimer = null;
      }
      if (this.graphIdleResumeTimer) {
        clearTimeout(this.graphIdleResumeTimer);
      }
      this.graphIdleResumeTimer = setTimeout(() => {
        this.graphFrozen = false;
        this.graphRenderedSignature = "";
        this.renderGraph(this.graphDataCache);
      }, this.graphIdleResumeDelayMs);
      this.graphRenderedSignature = "";
      this.renderGraph(this.graphDataCache);
    },

    scheduleGraphMotion() {
      if (this.graphMode !== "force" || this.graphFrozen || this.activeTab !== "map") {
        return;
      }
      if (this.graphMotionTimer) {
        clearTimeout(this.graphMotionTimer);
      }
      this.graphMotionTimer = setTimeout(() => {
        if (this.graphMode !== "force" || this.graphFrozen || this.activeTab !== "map") {
          return;
        }
        this.graphRenderedSignature = "";
        this.renderGraph(this.graphDataCache);
      }, 12000);
    },

    graphExplanation(category, name) {
      if (category === "source") {
        return `${name} e' un nodo sorgente. Cliccandolo stai isolando un host che origina connessioni verso altri host o servizi. Ti serve per capire chi avvia i flussi.`;
      }
      if (category === "destination") {
        return `${name} e' un nodo destinazione. Cliccandolo stai osservando chi riceve traffico. Ti serve per capire quali asset sono bersaglio dei flussi.`;
      }
      return `${name} e' un nodo socket/servizio. Ti mostra l'estremo ip:porta usato nel flusso, utile per capire con precisione quali socket sorgente parlano con quali socket destinazione.`;
    },

    scheduleVisualRefresh() {
      requestAnimationFrame(() => {
        if (this.activeTab === "timeline" && this.timelineRows.length) {
          this.renderTimeline();
        }
        if (this.graphChart && this.activeTab === "map") {
          this.graphChart.resize();
        }
        if (this.map && this.activeTab === "map") {
          this.map.invalidateSize(true);
        }
        this.syncTimelinePickers();
      });
    },

    openSubnetModal(subnet = null) {
      this.subnetForm = subnet
        ? { ...subnet }
        : { id: null, name: "", cidr: "", scope: this.catalogs.subnet_scopes[0] || "internal", enabled: true };
      this.subnetModalOpen = true;
    },

    async persistSubnetForm() {
      if (this.subnetForm.scope && !this.catalogs.subnet_scopes.includes(this.subnetForm.scope)) {
        await this.persistCatalogValue("subnet_scopes", this.subnetForm.scope, true);
      }
      const payload = this.subnets.filter((item) => item.id !== this.subnetForm.id);
      payload.push({ ...this.subnetForm });
      await fetch("/api/config/subnets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.map(({ id, ...rest }) => rest)),
      });
      this.subnetModalOpen = false;
      await this.refreshAll();
    },

    async removeSubnet(subnetId) {
      const payload = this.subnets.filter((item) => item.id !== subnetId);
      await fetch("/api/config/subnets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.map(({ id, ...rest }) => rest)),
      });
      await this.refreshAll();
    },

    openAlertModal(alert = null) {
      this.alertForm = alert
        ? { ...alert }
        : { id: null, name: "", metric: this.catalogs.alert_metrics[0] || "blocked_connections_per_source_ip", threshold: 50, window_seconds: 60, enabled: true };
      this.alertModalOpen = true;
    },

    async persistAlertForm() {
      if (this.alertForm.metric && !this.catalogs.alert_metrics.includes(this.alertForm.metric)) {
        await this.persistCatalogValue("alert_metrics", this.alertForm.metric, true);
      }
      const payload = this.alerts.filter((item) => item.id !== this.alertForm.id);
      payload.push({ ...this.alertForm });
      await fetch("/api/config/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.map(({ id, ...rest }) => rest)),
      });
      this.alertModalOpen = false;
      await this.refreshAll();
    },

    async removeAlert(alertId) {
      const payload = this.alerts.filter((item) => item.id !== alertId);
      await fetch("/api/config/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.map(({ id, ...rest }) => rest)),
      });
      await this.refreshAll();
    },

    async runAnalysis() {
      const payload = { model: this.analysis.model, prompt: this.analysis.prompt };
      if (this.timelineSelection) {
        payload.start_time = this.timelineSelection.startIso;
        payload.end_time = this.timelineSelection.endIso;
      } else if (this.timelineFilters.start && this.timelineFilters.end) {
        payload.start_time = new Date(this.timelineFilters.start).toISOString();
        payload.end_time = new Date(this.timelineFilters.end).toISOString();
      }
      await this.streamAnalysis(payload, { mirrorToModal: false });
    },

    async runTimelineSelectionAnalysis() {
      if (!this.timelineSelection) {
        this.statusMessage = "Definisci prima una finestra sulla timeline";
        return;
      }
      const payload = {
        model: this.analysis.model,
        prompt: this.analysis.prompt,
        start_time: this.timelineSelection.startIso,
        end_time: this.timelineSelection.endIso,
      };
      await this.streamAnalysis(payload, { mirrorToModal: true });
    },

    async streamAnalysis(payload, { mirrorToModal = false } = {}) {
      this.analysis.output = "";
      if (mirrorToModal) {
        this.timelineAiOutput = "";
        this.timelineAiModalOpen = true;
        this.timelineAiBusy = true;
      }
      this.statusMessage = "Streaming risposta Ollama";
      try {
        const response = await fetch("/api/ai/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok || !response.body) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          this.analysis.output += chunk;
          if (mirrorToModal) {
            this.timelineAiOutput += chunk;
          }
        }
        this.statusMessage = "Analisi completata";
      } finally {
        if (mirrorToModal) {
          this.timelineAiBusy = false;
        }
      }
    },
  };
}
