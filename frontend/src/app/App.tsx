import { useCallback, useMemo, useState } from 'react';

import { AiPanel } from '../features/ai/AiPanel';
import { ConfigPanel } from '../features/config/ConfigPanel';
import { LogsPanel } from '../features/logs/LogsPanel';
import { MapGraphPanel } from '../features/map/MapGraphPanel';
import { OverviewPanel } from '../features/overview/OverviewPanel';
import { TimelinePanel } from '../features/timeline/TimelinePanel';
import type { RealtimeMessage } from '../lib/api/types';
import { useRealtime } from '../lib/realtime/client';
import type { DashboardTimeScope } from '../lib/timeScope';
import { buildDefaultTimeScope } from '../lib/timeScope';
import { AppShell } from './AppShell.tsx';
import { ErrorBoundary } from './ErrorBoundary';

type AppTab = 'timeline' | 'alerts' | 'map' | 'logs' | 'ai';

const tabs: Array<{ id: AppTab; title: string; description: string }> = [
  { id: 'timeline', title: 'Timeline', description: 'Vista eventi multi-traccia' },
  { id: 'alerts', title: 'Classificazioni', description: 'Top card, reti, classi e soglie' },
  { id: 'map', title: 'Geomappa / Grafo', description: 'Overlay geografici e relazioni rete' },
  { id: 'logs', title: 'Log', description: 'Tabella completa con filtri e pager' },
  { id: 'ai', title: 'Analisi AI', description: 'Prompt, modelli e streaming Ollama' },
];

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('timeline');
  const [timeScope, setTimeScope] = useState<DashboardTimeScope>(() => buildDefaultTimeScope());
  const [lastRealtimeEventAt, setLastRealtimeEventAt] = useState<string | null>(null);
  const [lastBatchCount, setLastBatchCount] = useState<number>(0);

  const handleRealtimeMessage = useCallback((message: RealtimeMessage) => {
    if (message.type === 'ingestion_batch') {
      setLastRealtimeEventAt(message.timestamp);
      setLastBatchCount(message.count);
      return;
    }
    if (message.type === 'pong') {
      setLastRealtimeEventAt(message.timestamp);
    }
  }, []);

  const realtimeStatus = useRealtime(['dashboard', 'logs', 'timeline', 'map', 'graph', 'alerts'], handleRealtimeMessage);

  const handleTimeScopeChange = useCallback((nextScope: DashboardTimeScope) => {
    setTimeScope((current) => (
      current.startTime === nextScope.startTime &&
      current.endTime === nextScope.endTime &&
      current.isCustom === nextScope.isCustom
    ) ? current : nextScope);
  }, []);

  const statusLabel = useMemo(() => {
    if (realtimeStatus !== 'live' || !lastRealtimeEventAt) {
      return '';
    }
    const formattedTime = new Date(lastRealtimeEventAt).toLocaleTimeString('it-IT');
    return lastBatchCount > 0 ? `Ultimo batch live: ${lastBatchCount} eventi • ${formattedTime}` : `Heartbeat live • ${formattedTime}`;
  }, [lastBatchCount, lastRealtimeEventAt, realtimeStatus]);

  return (
    <AppShell activeTab={activeTab} onSelectTab={setActiveTab} realtimeStatus={realtimeStatus} statusLabel={statusLabel} tabs={tabs}>
      <ErrorBoundary>
        {activeTab === 'timeline' && <TimelinePanel timeScope={timeScope} onTimeScopeChange={handleTimeScopeChange} />}
        {activeTab === 'alerts' && (
          <div className="grid gap-4">
            <OverviewPanel realtimeStatus={realtimeStatus} timeScope={timeScope} />
            <ConfigPanel embedded />
          </div>
        )}
        {activeTab === 'map' && <MapGraphPanel timeScope={timeScope} />}
        {activeTab === 'logs' && <LogsPanel timeScope={timeScope} />}
        {activeTab === 'ai' && <AiPanel timeScope={timeScope} />}
      </ErrorBoundary>
    </AppShell>
  );
}
