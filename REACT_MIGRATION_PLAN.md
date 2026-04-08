# React Migration Plan for `mysoc`

## Goal

Port the current dark forensic dashboard from `HTML + Alpine.js + vanilla JS` to a **modular React app** without losing the current UX strengths:

- dark, dense analyst layout
- timeline / map / graph focus
- realtime updates for newly ingested logs
- incremental, low-risk rollout

---

## Current State

Today the UI is still based on:

- `app/static/index.html`
- `app/static/js/app.js`
- `app/static/css/app.css`

It already has:

- modularized backend APIs in FastAPI
- custom timeline rendering
- ECharts graph rendering
- Leaflet map rendering
- new **WebSocket realtime push** for incremental updates

What is still missing for a full React migration:

- React component tree
- centralized store
- removal of `x-data`, `x-model`, `x-show`, `@click`
- DOM/canvas/chart ownership moved into components/hooks

---

## Target Frontend Architecture

```text
frontend/
  src/
    app/
      AppShell.tsx
      routes.tsx
    components/
      layout/
      timeline/
      alerts/
      map/
      logs/
      ai/
    stores/
      dashboardStore.ts
      timelineStore.ts
      logsStore.ts
      mapStore.ts
      alertsStore.ts
      aiStore.ts
      realtimeStore.ts
    hooks/
      useRealtime.ts
      useDebounce.ts
      useTimeScope.ts
    api/
      client.ts
      dashboard.ts
      config.ts
      ai.ts
    lib/
      timelineRenderer.ts
      formatters.ts
```

### Recommended stack

- `React + TypeScript`
- `Vite`
- `Zustand` for state/store
- `echarts-for-react` only as wrapper, keeping ECharts where useful
- `react-leaflet` for map integration
- keep current CSS tokens / dark palette, progressively move to Tailwind config or CSS modules

---

## Migration Strategy

### Phase 0 — Stabilize current app ✅

Already done in this iteration:

- WebSocket endpoint for live updates
- incremental refresh in current Alpine frontend
- polling downgraded to fallback instead of primary strategy

### Phase 1 — Scaffold React in parallel

Create a separate `frontend/` app served in parallel with the existing SPA.

Deliverables:

- Vite app bootstrapped
- dark theme tokens ported
- API client + shared types
- app shell reproducing current sidebar and panel layout

**Rule:** old frontend stays the default until the React version is verified.

### Phase 2 — Move state into stores

Before porting pages, define the shared stores.

#### Global state
- active tab
- selected time window
- health / status footer
- websocket connection status

#### Feature stores
- `timelineStore`
- `logsStore`
- `mapStore`
- `alertsStore`
- `aiStore`

This is the step that removes implicit Alpine state coupling.

### Phase 3 — Port the easiest tabs first

Recommended order:

1. `Logs`
2. `Alerts / Classificazioni`
3. `AI`
4. `Map / Graph`
5. `Timeline`

This order reduces risk while progressively validating the architecture.

### Phase 4 — Port timeline as dedicated React module

The timeline is the hardest part and should not be rewritten from scratch blindly.

Approach:

- extract current draw logic into pure functions
- isolate hit-testing, zoom, pan and selection logic
- wrap the canvas in a React component with refs
- keep performance-oriented rendering model

This should remain a **canvas-first React component**, not a DOM-heavy rewrite.

### Phase 5 — Make React the default UI

Once all tabs are stable:

- route `/` to the React build
- keep `?legacy=1` as fallback for a short transition period
- remove Alpine bindings only after verification in production-like use

---

## Realtime Architecture

The recommended realtime model for `mysoc` is:

- **WebSocket** as primary transport
- server emits `ingestion_batch` events when new logs are committed
- frontend applies **incremental updates** to:
  - log table
  - timeline buffer
  - graph edges/nodes
  - map points
- full refresh only on:
  - filter changes
  - date window changes
  - explicit user action
  - websocket fallback/recovery scenarios

This is better than classic polling for this use case because the app is event-driven and analyst-facing.

---

## Component Boundaries

### `TimelinePage`
Owns:
- visible window
- row grouping / track state
- selected event
- AI window selection

### `MapPage`
Owns:
- map viewport
- geo points
- selected marker
- viewport-locked fetch logic

### `NetworkGraph`
Owns:
- graph mode (`force` / `sankey`)
- category filters
- frozen layout / node positions

### `LogsPage`
Owns:
- paginated rows
- client filters
- expand/collapse raw payloads

### `AlertsPage`
Owns:
- top cards
- subnet config
- alert thresholds
- detail drill-down

---

## UX / Design Rules

The new React UI must keep or improve:

- same dark palette (`night`, `panel`, `line`, `cyan`, `emerald`, `crimson`)
- same information density
- no unnecessary white space inflation
- keyboard-friendly analyst workflow
- visible live/realtime status in footer or header
- modular cards/panels that can be reordered later

---

## Risks and Controls

### Risk: timeline regression
**Control:** migrate it last and preserve the current renderer.

### Risk: graph performance drop
**Control:** keep ECharts/Canvas based rendering, do not over-render through React state alone.

### Risk: store complexity explosion
**Control:** split per-domain Zustand stores instead of one giant global store.

### Risk: rollout instability
**Control:** run old and new frontend in parallel until verified.

---

## Immediate Next Tasks

1. scaffold `frontend/` with `Vite + React + TS`
2. port the global shell/sidebar with the current dark layout
3. implement `realtimeStore` against `/api/ws/live`
4. port `Logs` page first
5. port `Alerts` page second
6. leave `Timeline` as final milestone

---

## Definition of Done

Migration is complete when:

- no `Alpine.js` remains in `index.html`
- no `x-data`, `x-model`, `x-show`, `@click` bindings remain
- timeline, map and graph are isolated React components
- state is centralized in typed stores
- realtime works via WebSocket without full refetch on every event
- old frontend can be removed safely
