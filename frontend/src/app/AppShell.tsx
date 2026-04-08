import type { ReactNode } from 'react';

import type { RealtimeStatus } from '../lib/api/types';

interface TabDefinition<T extends string> {
  id: T;
  title: string;
  description: string;
}

interface AppShellProps<T extends string> {
  activeTab: T;
  onSelectTab: (tab: T) => void;
  realtimeStatus: RealtimeStatus;
  statusLabel: string;
  tabs: Array<TabDefinition<T>>;
  children: ReactNode;
}

const statusAccent: Record<RealtimeStatus, string> = {
  live: 'text-emerald-300',
  connecting: 'text-amber-300',
  reconnecting: 'text-amber-300',
  offline: 'text-rose-300',
};

export function AppShell<T extends string>({
  activeTab,
  onSelectTab,
  realtimeStatus,
  statusLabel,
  tabs,
  children,
}: AppShellProps<T>) {
  return (
    <div className="app-shell bg-grid">
      <div className="app-workspace mx-auto flex w-full max-w-[1800px] flex-col overflow-hidden px-4 py-4 lg:flex-row lg:gap-4">
        <aside className="app-sidebar app-sidebar-compact mb-4 w-full rounded-3xl border border-line bg-panel/80 p-4 shadow-2xl shadow-cyan-500/10 backdrop-blur lg:mb-0 lg:w-60 lg:shrink-0">
          <div className="mb-5">
            <div className="app-caption text-cyan">mysoc</div>
            <div className="mt-2 app-title text-white">Security Operations Center</div>
          </div>

          <nav className="sidebar-nav space-y-2" aria-label="mysoc main tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`sidebar-tab w-full rounded-2xl border px-4 py-3 text-left transition ${
                  activeTab === tab.id
                    ? 'border-cyan bg-cyan/10 text-white'
                    : 'border-line bg-black/20 text-slate-300 hover:border-cyan/40'
                }`}
                onClick={() => onSelectTab(tab.id)}
                type="button"
              >
                <div className="app-body app-strong">{tab.title}</div>
                <div className="app-body mt-1 text-slate-500">{tab.description}</div>
              </button>
            ))}
          </nav>

          <div className="sidebar-status">
            <div className={`app-body ${statusAccent[realtimeStatus]}`}>
              WebSocket: <span className="app-strong">{realtimeStatus === 'reconnecting' ? 'connecting' : realtimeStatus}</span>
            </div>
            {statusLabel ? <div className="app-body truncate text-slate-300">{statusLabel}</div> : null}
          </div>
        </aside>

        <main className="app-main min-w-0 flex-1">{children}</main>
      </div>

      <footer className="mx-auto flex w-full max-w-[1800px] items-center px-5 pb-4 text-[12px] text-slate-500">
        <span>mysoc</span>
      </footer>
    </div>
  );
}
