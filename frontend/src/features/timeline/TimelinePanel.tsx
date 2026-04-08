import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react';

import { postTimelineDetail, postTimelineOverview, streamAiAnalysis } from '../../lib/api/client';
import type {
  RealtimeMessage,
  TimelineDetailResponse,
  TimelineEvent,
  TimelineOverviewResponse,
  TimelinePoint,
  TimelineRowPayload,
  TimelineTrackBy,
} from '../../lib/api/types';
import { useRealtime } from '../../lib/realtime/client';
import type { DashboardTimeScope } from '../../lib/timeScope';
import { createDashboardTimeScope } from '../../lib/timeScope';

const defaultPrompt =
  "Sei un analista cyber e forense. Analizza la finestra timeline selezionata, evidenzia pattern sospetti, priorita', impatti e azioni operative. Correla source IP, destinazioni e porte piu' rilevanti.";

const trackOptions: Array<{ value: TimelineTrackBy; label: string }> = [
  { value: 'event', label: 'Eventi generali' },
  { value: 'traffic_flow', label: 'Traffic flow' },
  { value: 'source_ip', label: 'Source IP' },
  { value: 'destination_ip', label: 'Destination IP' },
  { value: 'destination_port', label: 'Destination port' },
  { value: 'action', label: 'Action' },
];

const DEFAULT_COLLAPSED_GROUPS: TimelineTrackBy[] = [];
const TIMELINE_MAX_ROWS_PER_GROUP = 12;
const TIMELINE_LOOKBACK_MINUTES = 10080;
const CORRELATION_WINDOW_MS = 30_000;

interface TimelineBounds {
  start: string | null;
  end: string | null;
}

interface TimelineSelection {
  startMs: number;
  endMs: number;
  startIso: string;
  endIso: string;
}

interface TimelineSelectionDraft {
  anchorPx: number;
  currentPx: number;
}

interface TimelineLayout {
  width: number;
  height: number;
  plotLeft: number;
  plotTop: number;
  plotWidth: number;
  plotHeight: number;
  plotBottom: number;
  rowHeight: number;
}

interface TimelineHitPoint {
  x: number;
  y: number;
  radius: number;
  event: TimelineEvent | null;
  timeMs: number;
}

interface TimelinePanDraft {
  anchorX: number;
  anchorStartMs: number;
  anchorEndMs: number;
}

interface LoadTimelineOverrides {
  startTime?: string;
  endTime?: string;
  trackSelections?: TimelineTrackBy[];
  collapsedGroups?: TimelineTrackBy[];
}

interface LoadTimelineDetailOptions {
  rows?: TimelineRowPayload[];
  bufferCap?: number;
}

interface TimelinePanelProps {
  timeScope: DashboardTimeScope;
  onTimeScopeChange: (scope: DashboardTimeScope) => void;
}

export function TimelinePanel({ timeScope, onTimeScopeChange }: TimelinePanelProps) {
  const defaultWindow = useMemo(() => ({ start: timeScope.startTime, end: timeScope.endTime }), [timeScope.endTime, timeScope.startTime]);
  const [startTime, setStartTime] = useState<string>(defaultWindow.start);
  const [endTime, setEndTime] = useState<string>(defaultWindow.end);
  const [trackSelections, setTrackSelections] = useState<TimelineTrackBy[]>(trackOptions.map((option) => option.value));
  const [collapsedGroups, setCollapsedGroups] = useState<TimelineTrackBy[]>(DEFAULT_COLLAPSED_GROUPS);
  const [rows, setRows] = useState<TimelineRowPayload[]>([]);
  const [overviewPoints, setOverviewPoints] = useState<TimelinePoint[]>([]);
  const [detailPoints, setDetailPoints] = useState<TimelinePoint[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [detailMode, setDetailMode] = useState<'aggregate' | 'events'>('aggregate');
  const [bucketLabel, setBucketLabel] = useState<string>('');
  const [detailBucketLabel, setDetailBucketLabel] = useState<string>('');
  const [windowTotal, setWindowTotal] = useState<number>(0);
  const [windowTruncated, setWindowTruncated] = useState<boolean>(false);
  const [bufferCap, setBufferCap] = useState<number>(50_000);
  const [timelineBounds, setTimelineBounds] = useState<TimelineBounds>({ start: null, end: null });
  const [absoluteBounds, setAbsoluteBounds] = useState<TimelineBounds>({ start: null, end: null });
  const [visibleRange, setVisibleRange] = useState<TimelineBounds>({ start: null, end: null });
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<boolean>(false);
  const [selectionDraft, setSelectionDraft] = useState<TimelineSelectionDraft | null>(null);
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const [selectionCustom, setSelectionCustom] = useState<boolean>(false);
  const [pinnedTimeMs, setPinnedTimeMs] = useState<number | null>(null);
  const [correlationTime, setCorrelationTime] = useState<string>('');
  const [correlatedEvents, setCorrelatedEvents] = useState<TimelineEvent[]>([]);
  const [analysisPrompt, setAnalysisPrompt] = useState<string>(defaultPrompt);
  const [analysisOutput, setAnalysisOutput] = useState<string>('');
  const [analysisBusy, setAnalysisBusy] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [statusHint, setStatusHint] = useState<string>('Timeline pronta');
  const [hoveredRowLabel, setHoveredRowLabel] = useState<string>('');

  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<TimelineLayout | null>(null);
  const hitPointsRef = useRef<TimelineHitPoint[]>([]);
  const panDraftRef = useRef<TimelinePanDraft | null>(null);
  const overviewDragRef = useRef<boolean>(false);
  const detailDebounceRef = useRef<number | null>(null);
  const initializedRef = useRef<boolean>(false);

  const selectedEvent = useMemo(
    () => timelineEvents.find((event) => event.id === selectedEventId) ?? timelineEvents[0] ?? null,
    [selectedEventId, timelineEvents],
  );
  const timelineCanvasHeight = useMemo(() => Math.max(420, (rows.length * 34) + 56), [rows.length]);

  const orderedTimes = useMemo(() => {
    const source = detailMode === 'events' ? timelineEvents.map((event) => toMs(event.time)) : detailPoints.map((point) => toMs(point.bucket_time));
    return [...new Set(source.filter((value): value is number => Number.isFinite(value)))].sort((left, right) => left - right);
  }, [detailMode, detailPoints, timelineEvents]);

  const updateCorrelations = useCallback(
    (pivotMs: number | null) => {
      if (pivotMs === null || !Number.isFinite(pivotMs)) {
        setCorrelationTime('');
        setCorrelatedEvents([]);
        return;
      }

      const snappedMs = findNearestTime(orderedTimes, pivotMs);
      if (!Number.isFinite(snappedMs)) {
        setCorrelationTime('');
        setCorrelatedEvents([]);
        return;
      }

      setPinnedTimeMs(snappedMs);
      setCorrelationTime(new Date(snappedMs).toLocaleString('it-IT'));
      setCorrelatedEvents(
        timelineEvents
          .filter((event) => {
            const eventMs = toMs(event.time);
            return Number.isFinite(eventMs) && Math.abs(eventMs - snappedMs) <= CORRELATION_WINDOW_MS;
          })
          .slice(0, 12),
      );
    },
    [orderedTimes, timelineEvents],
  );

  const loadTimelineDetailWindow = useCallback(
    async (startIso: string | null, endIso: string | null, options?: LoadTimelineDetailOptions) => {
      const rowsToUse = options?.rows ?? rows;
      if (!startIso || !endIso || !rowsToUse.length) {
        setDetailMode('aggregate');
        setTimelineEvents([]);
        setDetailPoints([]);
        setWindowTotal(0);
        setWindowTruncated(false);
        setSelectedEventId(null);
        updateCorrelations(null);
        return;
      }

      const payload = await postTimelineDetail({
        start_time: startIso,
        end_time: endIso,
        rows: rowsToUse.map((row) => ({
          id: row.id,
          track_key: row.track_key,
          label: row.label,
          value: row.value ?? null,
          aggregated: row.aggregated,
        })),
      });

      applyDetailPayload(payload, options?.bufferCap ?? bufferCap, setBufferCap, setDetailMode, setDetailBucketLabel, setWindowTotal, setWindowTruncated, setTimelineEvents, setDetailPoints, setSelectedEventId);

      const firstRelevantTime = payload.mode === 'events'
        ? payload.events[0]?.time ?? null
        : payload.points[0]?.bucket_time ?? null;
      updateCorrelations(firstRelevantTime ? toMs(firstRelevantTime) : null);
    },
    [bufferCap, rows, updateCorrelations],
  );

  const loadTimelineWindow = useCallback(
    async (overrides?: LoadTimelineOverrides) => {
      const nextStart = overrides?.startTime ?? startTime;
      const nextEnd = overrides?.endTime ?? endTime;
      const nextTracks = overrides?.trackSelections ?? trackSelections;
      const nextCollapsed = overrides?.collapsedGroups ?? collapsedGroups;

      setLoading(true);
      setError('');
      try {
        const payload = await postTimelineOverview({
          minutes: TIMELINE_LOOKBACK_MINUTES,
          start_time: toIso(nextStart) ?? null,
          end_time: toIso(nextEnd) ?? null,
          tracks: nextTracks,
          collapsed_groups: nextCollapsed,
          max_rows_per_group: TIMELINE_MAX_ROWS_PER_GROUP,
        });

        applyOverviewPayload(payload, setRows, setOverviewPoints, setTimelineBounds, setAbsoluteBounds, setBucketLabel, setVisibleRange, setBufferCap);
        const nextVisible = {
          start: payload.initial_visible_start ?? payload.requested_start ?? null,
          end: payload.initial_visible_end ?? payload.requested_end ?? null,
        };
        const baseSelection = createSelectionFromRange(
          toIso(nextStart) ?? nextVisible.start,
          toIso(nextEnd) ?? nextVisible.end,
        );

        setSelection(baseSelection);
        setSelectionMode(false);
        setSelectionCustom(false);
        setSelectionDraft(null);
        setPinnedTimeMs(null);
        setStatusHint('Timeline pronta');

        await loadTimelineDetailWindow(nextVisible.start, nextVisible.end, {
          rows: payload.rows ?? [],
          bufferCap: normalizeBufferCap(payload.buffer_cap),
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Errore caricamento timeline');
        setStatusHint('Errore timeline');
      } finally {
        setLoading(false);
      }
    },
    [collapsedGroups, loadTimelineDetailWindow, startTime, endTime, trackSelections],
  );

  const scheduleDetailLoad = useCallback(
    (startIso: string | null, endIso: string | null) => {
      if (detailDebounceRef.current) {
        window.clearTimeout(detailDebounceRef.current);
      }
      if (!startIso || !endIso) {
        return;
      }
      detailDebounceRef.current = window.setTimeout(() => {
        void loadTimelineDetailWindow(startIso, endIso);
      }, 140);
    },
    [loadTimelineDetailWindow],
  );

  useEffect(() => {
    setStartTime(timeScope.startTime);
    setEndTime(timeScope.endTime);
  }, [timeScope.endTime, timeScope.startTime]);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    void loadTimelineWindow({ startTime: defaultWindow.start, endTime: defaultWindow.end });
  }, [defaultWindow.end, defaultWindow.start, loadTimelineWindow]);

  useEffect(() => {
    if (!selection) {
      return;
    }
    onTimeScopeChange(createDashboardTimeScope(toDateTimeLocal(selection.startIso), toDateTimeLocal(selection.endIso), selectionCustom));
  }, [onTimeScopeChange, selection, selectionCustom]);

  useEffect(() => {
    return () => {
      if (detailDebounceRef.current) {
        window.clearTimeout(detailDebounceRef.current);
      }
    };
  }, []);

  const handleRealtime = useCallback(
    (message: RealtimeMessage) => {
      if (message.type === 'ingestion_batch') {
        void loadTimelineWindow();
      }
    },
    [loadTimelineWindow],
  );

  useRealtime(['timeline'], handleRealtime);

  const renderTimeline = useCallback(() => {
    const mainCanvas = mainCanvasRef.current;
    const overviewCanvas = overviewCanvasRef.current;
    if (!mainCanvas || !overviewCanvas) {
      return;
    }

    resizeCanvas(mainCanvas);
    resizeCanvas(overviewCanvas);

    const layout = buildTimelineLayout(mainCanvas, rows.length);
    layoutRef.current = layout;
    hitPointsRef.current = [];

    const ctx = mainCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, layout.width, layout.height);
    ctx.fillStyle = '#081018';
    ctx.fillRect(0, 0, layout.width, layout.height);

    const [globalStartMs, globalEndMs] = resolveRangeMs(timelineBounds, absoluteBounds);
    const [visibleStartMs, visibleEndMs] = resolveRangeMs(visibleRange, timelineBounds.start || timelineBounds.end ? timelineBounds : absoluteBounds);
    if (!rows.length || !Number.isFinite(globalStartMs) || !Number.isFinite(globalEndMs) || !Number.isFinite(visibleStartMs) || !Number.isFinite(visibleEndMs)) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '14px IBM Plex Sans, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nessun evento disponibile per la timeline', layout.width / 2, layout.height / 2);
      renderTimelineOverview(overviewCanvas, overviewPoints, visibleRange, timelineBounds, absoluteBounds);
      return;
    }

    drawTimelineGrid(ctx, layout, visibleStartMs, visibleEndMs);
    drawTimelineRows(ctx, layout, rows);
    drawTimelineOverviewPoints(ctx, layout, rows, overviewPoints, visibleStartMs, visibleEndMs);
    drawTimelineDetailPoints(ctx, layout, rows, detailMode, detailPoints, timelineEvents, visibleStartMs, visibleEndMs, hitPointsRef);
    drawTimelineSelection(ctx, layout, selectionDraft, selection, selectionCustom, visibleStartMs, visibleEndMs);
    drawTimelinePinnedCursor(ctx, layout, pinnedTimeMs, visibleStartMs, visibleEndMs);
    renderTimelineOverview(overviewCanvas, overviewPoints, visibleRange, timelineBounds, absoluteBounds);
  }, [absoluteBounds, detailMode, detailPoints, overviewPoints, pinnedTimeMs, rows, selection, selectionCustom, selectionDraft, timelineBounds, timelineEvents, visibleRange]);

  useEffect(() => {
    if (mainCanvasRef.current) {
      mainCanvasRef.current.style.height = `${timelineCanvasHeight}px`;
    }
  }, [loading, timelineCanvasHeight]);

  useEffect(() => {
    renderTimeline();
  }, [renderTimeline]);

  function applyDateFilters() {
    void loadTimelineWindow({ startTime, endTime });
  }

  function resetWindow() {
    const next = buildDefaultLocalWindow();
    setStartTime(next.start);
    setEndTime(next.end);
    setSelectionMode(false);
    setSelectionDraft(null);
    setSelectionCustom(false);
    setAnalysisOutput('');
    void loadTimelineWindow({ startTime: next.start, endTime: next.end });
  }

  function toggleTrackSelection(track: TimelineTrackBy) {
    setTrackSelections((current) => {
      const next = current.includes(track) ? current.filter((item) => item !== track) : [...current, track];
      const normalizedNext = next.length ? next : [track];
      void loadTimelineWindow({ trackSelections: normalizedNext });
      return normalizedNext;
    });
  }

  function toggleTrackGroup(trackKey: TimelineTrackBy) {
    setCollapsedGroups((current) => {
      const next = current.includes(trackKey) ? current.filter((item) => item !== trackKey) : [...current, trackKey];
      void loadTimelineWindow({ collapsedGroups: next });
      return next;
    });
  }

  function toggleTimelineSelectionMode() {
    setSelectionMode((current) => {
      const next = !current;
      setSelectionDraft(null);
      setPinnedTimeMs(null);
      setStatusHint(next ? "Modalita' finestra timeline attiva: clicca un inizio e poi una fine sul grafico" : "Modalita' finestra timeline disattivata");
      return next;
    });
  }

  function clearTimelineSelection() {
    const nextSelection = createSelectionFromRange(toIso(startTime) ?? visibleRange.start, toIso(endTime) ?? visibleRange.end);
    setSelection(nextSelection);
    setSelectionCustom(false);
    setSelectionDraft(null);
    setSelectionMode(false);
    setAnalysisOutput('');
    setStatusHint('Finestra timeline cancellata');
    setPinnedTimeMs(null);
    updateCorrelations(nextSelection ? nextSelection.startMs : null);
    void loadTimelineDetailWindow(visibleRange.start, visibleRange.end);
  }

  async function runAnalysis() {
    const activeScope = selection ?? createSelectionFromRange(visibleRange.start, visibleRange.end);
    setAnalysisBusy(true);
    setAnalysisOutput('');
    try {
      await streamAiAnalysis(
        {
          model: 'llama3.1:8b',
          prompt: analysisPrompt,
          minutes: activeScope ? undefined : 60,
          start_time: activeScope?.startIso,
          end_time: activeScope?.endIso,
        },
        (chunk) => {
          setAnalysisOutput((current) => current + chunk);
        },
      );
    } catch (analysisError) {
      setAnalysisOutput(analysisError instanceof Error ? analysisError.message : 'Errore analisi AI');
    } finally {
      setAnalysisBusy(false);
    }
  }

  function handleMainCanvasMouseDown(event: ReactMouseEvent<HTMLCanvasElement>) {
    if (selectionMode) {
      return;
    }
    const layout = layoutRef.current;
    const canvas = mainCanvasRef.current;
    if (!layout || !canvas) {
      return;
    }
    const position = getCanvasPosition(event, canvas, layout);
    if (!position.inPlot) {
      return;
    }
    const [visibleStartMs, visibleEndMs] = resolveRangeMs(visibleRange, timelineBounds.start || timelineBounds.end ? timelineBounds : absoluteBounds);
    const anchorTimeMs = timeFromPixel(position.x, layout, visibleStartMs, visibleEndMs);
    if (!Number.isFinite(anchorTimeMs)) {
      return;
    }
    panDraftRef.current = {
      anchorX: position.x,
      anchorStartMs: visibleStartMs,
      anchorEndMs: visibleEndMs,
    };
  }

  function handleMainCanvasMouseMove(event: ReactMouseEvent<HTMLCanvasElement>) {
    const layout = layoutRef.current;
    const canvas = mainCanvasRef.current;
    if (!layout || !canvas) {
      return;
    }
    const position = getCanvasPosition(event, canvas, layout);
    const withinRows = position.y >= layout.plotTop && position.y <= layout.plotTop + layout.plotHeight;
    if (withinRows && position.x < layout.plotLeft - 6) {
      const rowIndex = Math.floor((position.y - layout.plotTop) / Math.max(1, layout.rowHeight));
      setHoveredRowLabel(rows[rowIndex]?.label ?? '');
    } else {
      setHoveredRowLabel('');
    }
    const [visibleStartMs, visibleEndMs] = resolveRangeMs(visibleRange, timelineBounds.start || timelineBounds.end ? timelineBounds : absoluteBounds);

    if (selectionMode && selectionDraft && position.inPlot) {
      setSelectionDraft({ ...selectionDraft, currentPx: position.x });
      return;
    }

    if (panDraftRef.current && position.inPlot) {
      const [absoluteStartMs, absoluteEndMs] = resolveRangeMs(timelineBounds, absoluteBounds);
      const spanMs = panDraftRef.current.anchorEndMs - panDraftRef.current.anchorStartMs;
      if (!Number.isFinite(spanMs) || spanMs <= 0) {
        return;
      }
      const deltaMs = ((panDraftRef.current.anchorX - position.x) / Math.max(1, layout.plotWidth)) * spanMs;
      let nextStartMs = panDraftRef.current.anchorStartMs + deltaMs;
      let nextEndMs = panDraftRef.current.anchorEndMs + deltaMs;
      if (nextStartMs < absoluteStartMs) {
        nextEndMs += absoluteStartMs - nextStartMs;
        nextStartMs = absoluteStartMs;
      }
      if (nextEndMs > absoluteEndMs) {
        nextStartMs -= nextEndMs - absoluteEndMs;
        nextEndMs = absoluteEndMs;
      }
      const nextRange = {
        start: new Date(nextStartMs).toISOString(),
        end: new Date(nextEndMs).toISOString(),
      };
      setVisibleRange(nextRange);
      setStatusHint('Pan timeline attivo');
      return;
    }

    if (!position.inPlot) {
      return;
    }

    const hoverTimeMs = timeFromPixel(position.x, layout, visibleStartMs, visibleEndMs);
    updateCorrelations(hoverTimeMs);
  }

  function handleMainCanvasMouseUp() {
    panDraftRef.current = null;
    scheduleDetailLoad(visibleRange.start, visibleRange.end);
  }

  function handleMainCanvasMouseLeave() {
    panDraftRef.current = null;
    setHoveredRowLabel('');
    scheduleDetailLoad(visibleRange.start, visibleRange.end);
  }

  function handleMainCanvasClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    const layout = layoutRef.current;
    const canvas = mainCanvasRef.current;
    if (!layout || !canvas) {
      return;
    }
    const position = getCanvasPosition(event, canvas, layout);
    if (!position.inPlot) {
      return;
    }

    const [visibleStartMs, visibleEndMs] = resolveRangeMs(visibleRange, timelineBounds.start || timelineBounds.end ? timelineBounds : absoluteBounds);

    if (selectionMode) {
      if (!selectionDraft) {
        setSelectionDraft({ anchorPx: position.x, currentPx: position.x });
        setStatusHint("Selezione avviata: scegli la fine della finestra timeline");
        return;
      }

      const startMs = timeFromPixel(selectionDraft.anchorPx, layout, visibleStartMs, visibleEndMs);
      const endMs = timeFromPixel(position.x, layout, visibleStartMs, visibleEndMs);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || Math.abs(endMs - startMs) < 1000) {
        setSelectionDraft(null);
        setSelectionMode(false);
        setStatusHint('Selezione timeline annullata');
        return;
      }

      const nextSelection = createSelectionFromMs(Math.min(startMs, endMs), Math.max(startMs, endMs));
      setSelection(nextSelection);
      setSelectionCustom(true);
      setSelectionDraft(null);
      setSelectionMode(false);
      setStatusHint('Finestra timeline personalizzata pronta per l’analisi AI');
      updateCorrelations(nextSelection.startMs);
      void loadTimelineDetailWindow(nextSelection.startIso, nextSelection.endIso);
      return;
    }

    const hitPoint = hitPointsRef.current.find((item) => Math.hypot(item.x - position.x, item.y - position.y) <= item.radius);
    if (hitPoint?.event) {
      setSelectedEventId(hitPoint.event.id);
      updateCorrelations(hitPoint.timeMs);
      return;
    }

    updateCorrelations(timeFromPixel(position.x, layout, visibleStartMs, visibleEndMs));
  }

  function handleOverviewWheel(event: ReactWheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const canvas = overviewCanvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const [visibleStartMs, visibleEndMs] = resolveRangeMs(visibleRange, timelineBounds.start || timelineBounds.end ? timelineBounds : absoluteBounds);
    const [absoluteStartMs, absoluteEndMs] = resolveRangeMs(timelineBounds, absoluteBounds);
    const spanMs = visibleEndMs - visibleStartMs;
    const absoluteSpanMs = absoluteEndMs - absoluteStartMs;
    if (!Number.isFinite(spanMs) || spanMs <= 0 || !Number.isFinite(absoluteSpanMs) || absoluteSpanMs <= 0) {
      return;
    }

    const factor = event.deltaY < 0 ? 0.8 : 1.25;
    const nextSpanMs = Math.min(absoluteSpanMs, Math.max(30_000, spanMs * factor));
    const anchorMs = absoluteStartMs + (absoluteSpanMs * ratio);

    let nextStartMs = anchorMs - (nextSpanMs * ratio);
    let nextEndMs = nextStartMs + nextSpanMs;
    if (nextStartMs < absoluteStartMs) {
      nextEndMs += absoluteStartMs - nextStartMs;
      nextStartMs = absoluteStartMs;
    }
    if (nextEndMs > absoluteEndMs) {
      nextStartMs -= nextEndMs - absoluteEndMs;
      nextEndMs = absoluteEndMs;
    }

    const nextRange = {
      start: new Date(nextStartMs).toISOString(),
      end: new Date(nextEndMs).toISOString(),
    };
    setVisibleRange(nextRange);
    setStatusHint(event.deltaY < 0 ? 'Zoom temporale: avvicina' : 'Zoom temporale: allarga');
    scheduleDetailLoad(nextRange.start, nextRange.end);
  }

  function moveVisibleRangeFromOverview(event: ReactMouseEvent<HTMLCanvasElement>) {
    const canvas = overviewCanvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const [absoluteStartMs, absoluteEndMs] = resolveRangeMs(timelineBounds, absoluteBounds);
    const [visibleStartMs, visibleEndMs] = resolveRangeMs(visibleRange, timelineBounds.start || timelineBounds.end ? timelineBounds : absoluteBounds);
    const spanMs = visibleEndMs - visibleStartMs;
    const absoluteSpanMs = absoluteEndMs - absoluteStartMs;
    if (!Number.isFinite(spanMs) || !Number.isFinite(absoluteSpanMs) || spanMs <= 0 || absoluteSpanMs <= 0) {
      return;
    }

    let nextStartMs = absoluteStartMs + (ratio * absoluteSpanMs) - (spanMs / 2);
    let nextEndMs = nextStartMs + spanMs;
    if (nextStartMs < absoluteStartMs) {
      nextStartMs = absoluteStartMs;
      nextEndMs = absoluteStartMs + spanMs;
    }
    if (nextEndMs > absoluteEndMs) {
      nextEndMs = absoluteEndMs;
      nextStartMs = absoluteEndMs - spanMs;
    }
    const nextRange = {
      start: new Date(nextStartMs).toISOString(),
      end: new Date(nextEndMs).toISOString(),
    };
    setVisibleRange(nextRange);
    scheduleDetailLoad(nextRange.start, nextRange.end);
  }

  function handleOverviewMouseDown(event: ReactMouseEvent<HTMLCanvasElement>) {
    overviewDragRef.current = true;
    moveVisibleRangeFromOverview(event);
  }

  function handleOverviewMouseMove(event: ReactMouseEvent<HTMLCanvasElement>) {
    if (!overviewDragRef.current) {
      return;
    }
    moveVisibleRangeFromOverview(event);
  }

  function handleOverviewMouseUp() {
    overviewDragRef.current = false;
  }

  function handleOverviewClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    moveVisibleRangeFromOverview(event);
  }

  return (
    <div className="app-section">
      <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,0.8fr)]">
        <section className="panel-card min-w-0 h-full">
          <div className="panel-header">
            <div className="min-w-0">
              <h2>Timeline analitica</h2>
              <p>Canvas interattivo con selezione finestra, scrubber, zoom e pan operativi.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary !px-3 !py-2" title="Resetta a ultimi 60 minuti" onClick={resetWindow}>
                ↺
              </button>
              <button
                type="button"
                className={`btn-secondary !px-3 !py-2 ${selectionMode ? '!border-cyan !bg-cyan/15 !text-white' : ''}`}
                title="Disegna finestra temporale"
                onClick={toggleTimelineSelectionMode}
              >
                ▭
              </button>
              <button type="button" className="btn-secondary !px-3 !py-2" title="Cancella finestra temporale" onClick={clearTimelineSelection}>
                ✕
              </button>
              <button type="button" className="btn-primary !px-3 !py-2" disabled={!selection} title="Analizza finestra con AI" onClick={() => void runAnalysis()}>
                AI
              </button>
            </div>
          </div>

          <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="field">
              <span>Start date</span>
              <input
                className="input-dark"
                type="datetime-local"
                title="Timeline start date"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <label className="field">
              <span>End date</span>
              <input
                className="input-dark"
                type="datetime-local"
                title="Timeline end date"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>
            <div className="flex items-end">
              <button type="button" className="btn-secondary w-full xl:w-auto" onClick={applyDateFilters}>
                Applica
              </button>
            </div>
          </div>

          <div className="mb-1 app-body text-slate-400">Finestra AI timeline: {selectionLabel(selection, selectionCustom)}</div>
          <div className="mb-1 app-body text-slate-500">{detailMode === 'events' ? `Drill-down reale: ${timelineEvents.length} eventi in buffer (${bufferCap} max)` : `Overview aggregata ${bucketLabel || 'auto'} | finestra visibile ${detailBucketLabel || 'auto'}`}</div>
          <div className="mb-3 app-body text-slate-500">{statusHint}</div>

          {loading ? <div className="empty-state">Caricamento timeline…</div> : null}
          {error ? <div className="empty-state">{error}</div> : null}

          {!loading && !error ? (
            <>
              <div id="timelineChart" className="chart-frame timeline-stage timeline-stage-scroll">
                <canvas
                  ref={mainCanvasRef}
                  id="timelineMainCanvas"
                  className="timeline-canvas"
                  aria-label="Timeline analitica"
                  title={hoveredRowLabel || 'Timeline analitica'}
                  height={timelineCanvasHeight}
                  onMouseDown={handleMainCanvasMouseDown}
                  onMouseMove={handleMainCanvasMouseMove}
                  onMouseUp={handleMainCanvasMouseUp}
                  onMouseLeave={handleMainCanvasMouseLeave}
                  onClick={handleMainCanvasClick}
                />
              </div>
              <div className="timeline-scrubber">
                <canvas
                  ref={overviewCanvasRef}
                  id="timelineOverviewCanvas"
                  className="timeline-canvas"
                  aria-label="Panoramica timeline"
                  onMouseDown={handleOverviewMouseDown}
                  onMouseMove={handleOverviewMouseMove}
                  onMouseUp={handleOverviewMouseUp}
                  onMouseLeave={handleOverviewMouseUp}
                  onClick={handleOverviewClick}
                  onWheel={handleOverviewWheel}
                />
              </div>
            </>
          ) : null}

        </section>

        <section className="panel-card min-w-0 h-full">
          <div className="panel-header">
            <div>
              <h2>Controlli e dettagli</h2>
              <p>Istante, evento e correlazioni per la finestra corrente.</p>
            </div>
          </div>

          <div className="panel-scroll space-y-3">
            <div className="rounded-2xl border border-line bg-black/20 p-4">
              <div className="app-body app-strong text-white">Istante selezionato</div>
              <div className="app-body mt-2 text-slate-400">{correlationTime || 'Muovi il mouse nella timeline per fissare il cursore verticale.'}</div>
            </div>

            <div className="rounded-2xl border border-line bg-black/20 p-4">
              <div className="app-body app-strong text-white">Evento selezionato</div>
              {selectedEvent ? (
                <div className="mt-3 space-y-2">
                  <div className="app-body app-strong text-white">{selectedEvent.summary ?? 'Evento timeline'}</div>
                  <div className="app-body text-slate-400">{formatTime(selectedEvent.time)}</div>
                  <div className="app-body text-slate-300">Action: <span>{selectedEvent.action ?? 'n/a'}</span></div>
                  <div className="app-body text-slate-300">Flow: <span>{selectedEvent.traffic_flow ?? 'n/a'}</span></div>
                  <div className="app-body text-slate-300">Source: <span>{selectedEvent.source_ip ?? 'n/a'}</span></div>
                  <div className="app-body text-slate-300">Destination: <span>{formatDestination(selectedEvent)}</span></div>
                  <pre className="app-pre !mt-3 !min-h-0">{selectedEvent.raw_message ?? 'No raw payload'}</pre>
                </div>
              ) : (
                <div className="app-body mt-2 text-slate-400">Clicca un punto della timeline per vedere qui il dettaglio mantenendo il focus sul contesto generale.</div>
              )}
            </div>

            {correlatedEvents.length ? (
              <div className="space-y-2">
                {correlatedEvents.map((event) => (
                  <button key={`${event.id}-${event.time}`} className="timeline-correlation-card" type="button" onClick={() => setSelectedEventId(event.id)}>
                    <span className="app-body app-strong text-white">{event.summary ?? event.track}</span>
                    <span className="app-body text-slate-400">{`${formatTime(event.time)} | ${event.traffic_flow || 'n/a'}`}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-line p-6 text-slate-500">Nessuna intersezione disponibile per l'istante corrente.</div>
            )}

            <div className="field stack-gap-top">
              <label>Prompt AI per la finestra timeline</label>
              <textarea className="textarea" title="Prompt timeline AI" value={analysisPrompt} onChange={(event) => setAnalysisPrompt(event.target.value)} />
            </div>
            <div className="actions actions--spaced">
              <button className="btn-primary" type="button" onClick={() => void runAnalysis()} disabled={analysisBusy || !selection}>
                {analysisBusy ? 'Analisi in corso…' : 'Analizza finestra'}
              </button>
            </div>
            <pre className="output-console">{analysisOutput || `Scope AI attuale: ${analysisScopeLabel(selection)}`}</pre>
          </div>
        </section>
      </div>
    </div>
  );
}

function applyOverviewPayload(
  payload: TimelineOverviewResponse,
  setRows: (value: TimelineRowPayload[]) => void,
  setOverviewPoints: (value: TimelinePoint[]) => void,
  setTimelineBounds: (value: TimelineBounds) => void,
  setAbsoluteBounds: (value: TimelineBounds) => void,
  setBucketLabel: (value: string) => void,
  setVisibleRange: (value: TimelineBounds) => void,
  setBufferCap: (value: number) => void,
) {
  setRows(payload.rows ?? []);
  setOverviewPoints(payload.points ?? []);
  setTimelineBounds({
    start: payload.requested_start ?? null,
    end: payload.requested_end ?? null,
  });
  setAbsoluteBounds({
    start: payload.absolute_min_time ?? null,
    end: payload.absolute_max_time ?? null,
  });
  setBucketLabel(payload.bucket_label ?? '');
  setVisibleRange({
    start: payload.initial_visible_start ?? payload.requested_start ?? null,
    end: payload.initial_visible_end ?? payload.requested_end ?? null,
  });
  setBufferCap(normalizeBufferCap(payload.buffer_cap));
}

function applyDetailPayload(
  payload: TimelineDetailResponse,
  fallbackBufferCap: number,
  setBufferCap: (value: number) => void,
  setDetailMode: (value: 'aggregate' | 'events') => void,
  setDetailBucketLabel: (value: string) => void,
  setWindowTotal: (value: number) => void,
  setWindowTruncated: (value: boolean) => void,
  setTimelineEvents: (value: TimelineEvent[]) => void,
  setDetailPoints: (value: TimelinePoint[]) => void,
  setSelectedEventId: (value: string | null | ((current: string | null) => string | null)) => void,
) {
  const nextBufferCap = normalizeBufferCap(payload.buffer_cap ?? fallbackBufferCap);
  setBufferCap(nextBufferCap);
  setDetailMode(payload.mode ?? 'aggregate');
  setDetailBucketLabel(payload.bucket_label ?? '');
  setWindowTotal(payload.events_total ?? 0);
  setWindowTruncated(Boolean(payload.truncated));

  const nextEvents = (payload.events ?? []).slice(-nextBufferCap);
  setTimelineEvents(nextEvents);
  setDetailPoints(payload.points ?? []);
  setSelectedEventId((current) => {
    if (current && nextEvents.some((event) => event.id === current)) {
      return current;
    }
    return nextEvents[0]?.id ?? null;
  });
}

function buildDefaultLocalWindow(): { start: string; end: string } {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
  return {
    start: toDateTimeLocal(oneHourAgo.toISOString()),
    end: toDateTimeLocal(now.toISOString()),
  };
}

function normalizeBufferCap(value: number | null | undefined): number {
  return value && value > 0 ? value : 50_000;
}

function toDateTimeLocal(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const pad = (amount: number) => String(amount).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function toIso(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toMs(value: string | null | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  return new Date(value).getTime();
}

function createSelectionFromRange(startIso: string | null | undefined, endIso: string | null | undefined): TimelineSelection | null {
  const startMs = toMs(startIso ?? null);
  const endMs = toMs(endIso ?? null);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  return createSelectionFromMs(Math.min(startMs, endMs), Math.max(startMs, endMs));
}

function createSelectionFromMs(startMs: number, endMs: number): TimelineSelection {
  return {
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

function selectionLabel(selection: TimelineSelection | null, selectionCustom: boolean): string {
  if (!selection || !selectionCustom) {
    return 'default ultimi 60 minuti';
  }
  return `${new Date(selection.startMs).toLocaleString('it-IT')} -> ${new Date(selection.endMs).toLocaleString('it-IT')}`;
}

function analysisScopeLabel(selection: TimelineSelection | null): string {
  if (!selection) {
    return 'ultimi 60 minuti';
  }
  return `${new Date(selection.startMs).toLocaleString('it-IT')} -> ${new Date(selection.endMs).toLocaleString('it-IT')}`;
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('it-IT') : 'n/a';
}

function formatDestination(event: TimelineEvent): string {
  if (!event.destination_ip) {
    return 'n/a';
  }
  return event.destination_port ? `${event.destination_ip}:${event.destination_port}` : event.destination_ip;
}

function resolveRangeMs(primary: TimelineBounds, fallback: TimelineBounds): [number, number] {
  const startMs = toMs(primary.start ?? fallback.start);
  const endMs = toMs(primary.end ?? fallback.end);
  return [startMs, endMs];
}

function resizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(rect.width * dpr));
  const nextHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function buildTimelineLayout(canvas: HTMLCanvasElement, rowCount: number): TimelineLayout {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const plotLeft = 220;
  const plotTop = 22;
  const plotRight = 22;
  const plotBottom = 26;
  const plotWidth = Math.max(80, width - plotLeft - plotRight);
  const plotHeight = Math.max(80, height - plotTop - plotBottom);
  const rowHeight = plotHeight / Math.max(1, rowCount || 1);
  return { width, height, plotLeft, plotTop, plotWidth, plotHeight, plotBottom, rowHeight };
}

function getCanvasPosition(
  event: Pick<ReactMouseEvent<HTMLCanvasElement>, 'clientX' | 'clientY'>,
  canvas: HTMLCanvasElement,
  layout: TimelineLayout,
): { x: number; y: number; inPlot: boolean } {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const inPlot = x >= layout.plotLeft && x <= layout.plotLeft + layout.plotWidth && y >= layout.plotTop && y <= layout.plotTop + layout.plotHeight;
  return { x, y, inPlot };
}

function timeFromPixel(pixelX: number, layout: TimelineLayout, visibleStartMs: number, visibleEndMs: number): number {
  const ratio = clamp((pixelX - layout.plotLeft) / Math.max(1, layout.plotWidth), 0, 1);
  return visibleStartMs + ((visibleEndMs - visibleStartMs) * ratio);
}

function pixelFromTimeMs(timeMs: number, layout: TimelineLayout, visibleStartMs: number, visibleEndMs: number): number {
  if (!Number.isFinite(timeMs) || !Number.isFinite(visibleStartMs) || !Number.isFinite(visibleEndMs) || visibleEndMs <= visibleStartMs) {
    return layout.plotLeft;
  }
  const ratio = (timeMs - visibleStartMs) / (visibleEndMs - visibleStartMs);
  return layout.plotLeft + (clamp(ratio, 0, 1) * layout.plotWidth);
}

function rowCenter(index: number, layout: TimelineLayout): number {
  return layout.plotTop + (index * layout.rowHeight) + (layout.rowHeight / 2);
}

function drawTimelineGrid(ctx: CanvasRenderingContext2D, layout: TimelineLayout, visibleStartMs: number, visibleEndMs: number) {
  const ticks = 8;
  ctx.strokeStyle = 'rgba(148,163,184,0.12)';
  ctx.lineWidth = 1;
  for (let index = 0; index <= ticks; index += 1) {
    const x = layout.plotLeft + (layout.plotWidth * (index / ticks));
    ctx.beginPath();
    ctx.moveTo(x, layout.plotTop);
    ctx.lineTo(x, layout.plotTop + layout.plotHeight);
    ctx.stroke();
    const timeMs = visibleStartMs + ((visibleEndMs - visibleStartMs) * (index / ticks));
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '12px IBM Plex Sans, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(new Date(timeMs).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }), x, layout.height - 8);
  }
  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.beginPath();
  ctx.moveTo(layout.plotLeft, layout.plotTop + layout.plotHeight);
  ctx.lineTo(layout.plotLeft + layout.plotWidth, layout.plotTop + layout.plotHeight);
  ctx.stroke();
}

function drawTimelineRows(ctx: CanvasRenderingContext2D, layout: TimelineLayout, rows: TimelineRowPayload[]) {
  const maxLabelWidth = Math.max(56, layout.plotLeft - 28);
  rows.forEach((row, index) => {
    const y = layout.plotTop + (index * layout.rowHeight);
    ctx.strokeStyle = 'rgba(148,163,184,0.1)';
    ctx.beginPath();
    ctx.moveTo(layout.plotLeft, y + layout.rowHeight);
    ctx.lineTo(layout.plotLeft + layout.plotWidth, y + layout.rowHeight);
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '13px IBM Plex Sans, Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    let label = row.label || '';
    if (ctx.measureText(label).width > maxLabelWidth) {
      while (label.length > 1 && ctx.measureText(`${label}...`).width > maxLabelWidth) {
        label = label.slice(0, -1);
      }
      label = `${label}...`;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(12, y, maxLabelWidth + 8, layout.rowHeight);
    ctx.clip();
    ctx.fillText(label, layout.plotLeft - 12, y + (layout.rowHeight * 0.62));
    ctx.restore();
  });
}

function drawTimelineOverviewPoints(
  ctx: CanvasRenderingContext2D,
  layout: TimelineLayout,
  rows: TimelineRowPayload[],
  points: TimelinePoint[],
  visibleStartMs: number,
  visibleEndMs: number,
) {
  const rowIndexMap = new Map(rows.map((row, index) => [row.id, index]));
  points.forEach((point) => {
    const timeMs = toMs(point.bucket_time);
    const rowIndex = rowIndexMap.get(point.row_id);
    if (!Number.isFinite(timeMs) || rowIndex === undefined || timeMs < visibleStartMs || timeMs > visibleEndMs) {
      return;
    }
    const x = pixelFromTimeMs(timeMs, layout, visibleStartMs, visibleEndMs);
    const y = rowCenter(rowIndex, layout);
    const radius = Math.max(2.5, Math.min(7, 2 + Math.log2((point.count || 1) + 1)));
    ctx.beginPath();
    ctx.fillStyle = 'rgba(148,163,184,0.28)';
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawTimelineDetailPoints(
  ctx: CanvasRenderingContext2D,
  layout: TimelineLayout,
  rows: TimelineRowPayload[],
  detailMode: 'aggregate' | 'events',
  detailPoints: TimelinePoint[],
  timelineEvents: TimelineEvent[],
  visibleStartMs: number,
  visibleEndMs: number,
  hitPointsRef: React.MutableRefObject<TimelineHitPoint[]>,
) {
  const rowIndexMap = new Map(rows.map((row, index) => [row.id, index]));
  if (detailMode === 'events') {
    rows.forEach((row, rowIndex) => {
      timelineEvents
        .filter((event) => timelineEventMatchesRow(event, row))
        .forEach((event) => {
          const timeMs = toMs(event.time);
          if (!Number.isFinite(timeMs) || timeMs < visibleStartMs || timeMs > visibleEndMs) {
            return;
          }
          const x = pixelFromTimeMs(timeMs, layout, visibleStartMs, visibleEndMs);
          const y = rowCenter(rowIndex, layout);
          const radius = 5;
          const color = timelineTrackColor(row.track_key, event);
          ctx.beginPath();
          ctx.fillStyle = color;
          ctx.shadowBlur = 18;
          ctx.shadowColor = color;
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          hitPointsRef.current.push({ x, y, radius: Math.max(8, radius + 4), event, timeMs });
        });
    });
    return;
  }

  detailPoints.forEach((point) => {
    const timeMs = toMs(point.bucket_time);
    const rowIndex = rowIndexMap.get(point.row_id);
    if (!Number.isFinite(timeMs) || rowIndex === undefined || timeMs < visibleStartMs || timeMs > visibleEndMs) {
      return;
    }
    const x = pixelFromTimeMs(timeMs, layout, visibleStartMs, visibleEndMs);
    const y = rowCenter(rowIndex, layout);
    const radius = Math.max(4, Math.min(10, 3 + Math.log2((point.count || 1) + 1)));
    const color = timelineTrackColor(point.track_key);
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.shadowBlur = 18;
    ctx.shadowColor = color;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    hitPointsRef.current.push({ x, y, radius: Math.max(8, radius + 4), event: null, timeMs });
  });
}

function drawTimelineSelection(
  ctx: CanvasRenderingContext2D,
  layout: TimelineLayout,
  selectionDraft: TimelineSelectionDraft | null,
  selection: TimelineSelection | null,
  selectionCustom: boolean,
  visibleStartMs: number,
  visibleEndMs: number,
) {
  const range = selectionDraft
    ? {
        startMs: timeFromPixel(Math.min(selectionDraft.anchorPx, selectionDraft.currentPx), layout, visibleStartMs, visibleEndMs),
        endMs: timeFromPixel(Math.max(selectionDraft.anchorPx, selectionDraft.currentPx), layout, visibleStartMs, visibleEndMs),
      }
    : selection && selectionCustom
      ? { startMs: selection.startMs, endMs: selection.endMs }
      : null;

  if (!range || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) {
    return;
  }

  const left = pixelFromTimeMs(range.startMs, layout, visibleStartMs, visibleEndMs);
  const right = pixelFromTimeMs(range.endMs, layout, visibleStartMs, visibleEndMs);
  ctx.fillStyle = 'rgba(34,211,238,0.12)';
  ctx.fillRect(left, layout.plotTop, Math.max(2, right - left), layout.plotHeight);
  ctx.strokeStyle = 'rgba(34,211,238,0.46)';
  ctx.strokeRect(left, layout.plotTop, Math.max(2, right - left), layout.plotHeight);
}

function drawTimelinePinnedCursor(
  ctx: CanvasRenderingContext2D,
  layout: TimelineLayout,
  pinnedTimeMs: number | null,
  visibleStartMs: number,
  visibleEndMs: number,
) {
  if (pinnedTimeMs === null || !Number.isFinite(pinnedTimeMs) || pinnedTimeMs < visibleStartMs || pinnedTimeMs > visibleEndMs) {
    return;
  }
  const x = pixelFromTimeMs(pinnedTimeMs, layout, visibleStartMs, visibleEndMs);
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, layout.plotTop);
  ctx.lineTo(x, layout.plotTop + layout.plotHeight);
  ctx.stroke();
}

function renderTimelineOverview(
  canvas: HTMLCanvasElement,
  points: TimelinePoint[],
  visibleRange: TimelineBounds,
  timelineBounds: TimelineBounds,
  absoluteBounds: TimelineBounds,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = 'rgba(2,6,23,0.78)';
  ctx.fillRect(0, 0, rect.width, rect.height);

  const [globalStartMs, globalEndMs] = resolveRangeMs(timelineBounds, absoluteBounds);
  if (!Number.isFinite(globalStartMs) || !Number.isFinite(globalEndMs) || globalEndMs <= globalStartMs) {
    return;
  }

  const padding = 12;
  const width = Math.max(1, rect.width - (padding * 2));
  const height = rect.height - 20;
  const maxCount = Math.max(1, ...points.map((point) => point.count || 0));

  points.forEach((point) => {
    const timeMs = toMs(point.bucket_time);
    if (!Number.isFinite(timeMs)) {
      return;
    }
    const ratio = (timeMs - globalStartMs) / (globalEndMs - globalStartMs);
    const x = padding + (ratio * width);
    const barHeight = Math.max(3, ((point.count || 0) / maxCount) * (height - 10));
    ctx.fillStyle = 'rgba(34,211,238,0.32)';
    ctx.fillRect(x, rect.height - 8 - barHeight, 2, barHeight);
  });

  const [visibleStartMs, visibleEndMs] = resolveRangeMs(visibleRange, timelineBounds.start || timelineBounds.end ? timelineBounds : absoluteBounds);
  const left = padding + (((visibleStartMs - globalStartMs) / (globalEndMs - globalStartMs)) * width);
  const right = padding + (((visibleEndMs - globalStartMs) / (globalEndMs - globalStartMs)) * width);
  ctx.fillStyle = 'rgba(34,211,238,0.14)';
  ctx.fillRect(left, 6, Math.max(4, right - left), rect.height - 12);
  ctx.strokeStyle = 'rgba(34,211,238,0.7)';
  ctx.strokeRect(left, 6, Math.max(4, right - left), rect.height - 12);
}

function timelineEventMatchesRow(event: TimelineEvent, row: TimelineRowPayload): boolean {
  if (row.aggregated || row.track_key === 'event') {
    return true;
  }
  const value = trackValue(row.track_key, event);
  return `${value ?? ''}` === `${row.value ?? ''}`;
}

function trackValue(trackKey: TimelineTrackBy, event: TimelineEvent): string | number | null {
  if (trackKey === 'source_ip') {
    return event.source_ip;
  }
  if (trackKey === 'destination_ip') {
    return event.destination_ip;
  }
  if (trackKey === 'destination_port') {
    return event.destination_port;
  }
  if (trackKey === 'traffic_flow') {
    return event.traffic_flow;
  }
  if (trackKey === 'action') {
    return event.action;
  }
  return event.summary;
}

function timelineTrackColor(trackKey: string, event?: TimelineEvent): string {
  if (trackKey === 'traffic_flow') {
    const flow = event?.traffic_flow ?? '';
    return {
      internal_lateral: '#22d3ee',
      internal_to_external: '#34d399',
      external_to_internal: '#ef4444',
      external_to_external: '#f59e0b',
    }[flow] ?? '#94a3b8';
  }
  if (trackKey === 'action') {
    return (event?.action ?? '').toLowerCase().includes('block') ? '#ef4444' : '#34d399';
  }
  if (trackKey === 'source_ip') {
    return '#22d3ee';
  }
  if (trackKey === 'destination_ip') {
    return '#c4b5fd';
  }
  if (trackKey === 'destination_port') {
    return '#f59e0b';
  }
  return '#f8fafc';
}

function findNearestTime(orderedTimes: number[], pivotMs: number): number {
  if (!orderedTimes.length) {
    return Number.NaN;
  }
  return orderedTimes.reduce((best, current) => (
    Math.abs(current - pivotMs) < Math.abs(best - pivotMs) ? current : best
  ), orderedTimes[0]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
