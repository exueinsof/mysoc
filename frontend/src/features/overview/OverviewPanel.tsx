import { useCallback, useEffect, useMemo, useState } from 'react';

import { getGeoIpStatus, getHealth, getIpDetail, getTopStats } from '../../lib/api/client';
import type { GeoIpStatus, HealthResponse, IpDetailResponse, RealtimeStatus, TopStatsResponse } from '../../lib/api/types';
import type { DashboardTimeScope } from '../../lib/timeScope';
import { getTimeScopeMinutes, toIso } from '../../lib/timeScope';

interface OverviewPanelProps {
  realtimeStatus: RealtimeStatus;
  timeScope: DashboardTimeScope;
}

interface OverviewState {
  loading: boolean;
  error: string;
  health: HealthResponse | null;
  geo: GeoIpStatus | null;
  blocked: TopStatsResponse | null;
  sockets: TopStatsResponse | null;
  flows: TopStatsResponse | null;
}

const initialState: OverviewState = {
  loading: true,
  error: '',
  health: null,
  geo: null,
  blocked: null,
  sockets: null,
  flows: null,
};

export function OverviewPanel({ realtimeStatus, timeScope }: OverviewPanelProps) {
  const [state, setState] = useState<OverviewState>(initialState);
  const [selectedInsight, setSelectedInsight] = useState<IpDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string>('');

  const timeQuery = useMemo(() => {
    const startIso = toIso(timeScope.startTime);
    const endIso = toIso(timeScope.endTime);
    return {
      minutes: startIso && endIso ? undefined : getTimeScopeMinutes(timeScope),
      start_time: startIso,
      end_time: endIso,
    };
  }, [timeScope.endTime, timeScope.startTime]);

  const loadOverview = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const [health, geo, blocked, sockets, flows] = await Promise.all([
        getHealth(),
        getGeoIpStatus(),
        getTopStats('source_ip', timeQuery),
        getTopStats('destination_socket', timeQuery),
        getTopStats('traffic_flow', timeQuery),
      ]);

      setState({
        loading: false,
        error: '',
        health,
        geo,
        blocked,
        sockets,
        flows,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'Errore caricamento overview',
      }));
    }
  }, [timeQuery]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function openTopInsight(detailType: 'source_ip' | 'none', value: string) {
    if (detailType !== 'source_ip' || !isIpv4(value)) {
      return;
    }
    setDetailLoading(true);
    setDetailError('');
    try {
      const detail = await getIpDetail(value, timeQuery);
      setSelectedInsight(detail);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Errore caricamento dettaglio IP');
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="app-section">
      <section className="panel-card panel-scroll">
        <div className="panel-header">
          <div>
            <h2>Classificazioni e dettaglio IP</h2>
            <p>Top card operative e drill-down rapido sugli IP piu rilevanti.</p>
            <div className="panel__subtitle">{timeScope.label}</div>
          </div>
          <button className="btn-primary" type="button" onClick={() => void loadOverview()}>
            Aggiorna
          </button>
        </div>

        <div className="panel-grid panel-grid--cards stack-gap-bottom">
          <MetricChip label="API health" value={state.health?.status ?? '...'} />
          <MetricChip label="Eventi geocodificati" value={`${state.geo?.geocoded_events ?? 0}`} />
          <MetricChip label="Stato WebSocket" value={realtimeStatus} />
        </div>

        {state.loading ? (
          <div className="empty-state">Caricamento overview…</div>
        ) : state.error ? (
          <div className="empty-state">{state.error}</div>
        ) : (
          <div className="panel-grid panel-grid--cards">
            <StatListCard title="Top Blocked IPs" detailType="source_ip" items={state.blocked?.items ?? []} onSelect={openTopInsight} />
            <StatListCard title="Top IP:Port Destination" detailType="none" items={state.sockets?.items ?? []} onSelect={openTopInsight} />
            <StatListCard title="Top Traffic Flow" detailType="none" items={state.flows?.items ?? []} onSelect={openTopInsight} />
          </div>
        )}

        <div className="detail-card">
          <strong>{selectedInsight?.ip ?? 'Nessun IP selezionato'}</strong>
          <div className="muted">
            {detailLoading
              ? 'Caricamento dettaglio IP…'
              : detailError ||
                (selectedInsight
                  ? `${selectedInsight.country ?? 'n/a'} / ${selectedInsight.city ?? 'n/a'} • ${selectedInsight.total_seen} eventi`
                  : 'Clicca un elemento di “Top Blocked IPs” per aprire il dettaglio.')}
          </div>

          {selectedInsight ? (
            <div className="panel-grid stack-gap-top">
              <div className="list">
                <div className="list-item"><span>First seen</span><span>{formatDate(selectedInsight.first_seen)}</span></div>
                <div className="list-item"><span>Last seen</span><span>{formatDate(selectedInsight.last_seen)}</span></div>
                <div className="list-item"><span>Coordinate</span><span>{formatCoordinates(selectedInsight.lat, selectedInsight.lon)}</span></div>
              </div>
              <InsightList title="Top destinazioni" items={selectedInsight.top_destinations} />
              <InsightList title="Top porte" items={selectedInsight.top_ports} />
              <InsightList title="Flows" items={selectedInsight.flows} />
              <InsightList title="Actions" items={selectedInsight.actions} />
            </div>
          ) : null}
        </div>
      </section>

    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="picker-card">
      <div className="label">{label}</div>
      <div className="metric">{value}</div>
    </div>
  );
}

function StatListCard({
  title,
  detailType,
  items,
  onSelect,
}: {
  title: string;
  detailType: 'source_ip' | 'none';
  items: Array<{ value: string; count: number }>;
  onSelect: (detailType: 'source_ip' | 'none', value: string) => void;
}) {
  return (
    <section className="picker-card">
      <div className="panel__header">
        <div>
          <h3 className="panel__title">{title}</h3>
        </div>
      </div>
      {items.length ? (
        <div className="list card-scroll">
          {items.slice(0, 6).map((item) => (
            <button className="list-item list-item--button" key={`${title}-${item.value}`} type="button" onClick={() => onSelect(detailType, item.value)}>
              <span>{item.value}</span>
              <span className="list-item__count">{item.count}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">Nessun dato disponibile.</div>
      )}
    </section>
  );
}

function InsightList({ title, items }: { title: string; items: Array<{ value: string; count: number }> }) {
  return (
    <div>
      <div className="panel__subtitle">{title}</div>
      <div className="list stack-gap-top-sm">
        {items.length ? (
          items.map((item) => (
            <div className="list-item" key={`${title}-${item.value}`}>
              <span>{item.value}</span>
              <span className="list-item__count">{item.count}</span>
            </div>
          ))
        ) : (
          <div className="empty-state">Nessun elemento.</div>
        )}
      </div>
    </div>
  );
}

function isIpv4(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('it-IT') : 'n/a';
}

function formatCoordinates(lat: number | null, lon: number | null): string {
  if (lat === null || lon === null) {
    return 'n/a';
  }
  return `${lat}, ${lon}`;
}