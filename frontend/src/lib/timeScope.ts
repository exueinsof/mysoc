export interface DashboardTimeScope {
  startTime: string;
  endTime: string;
  isCustom: boolean;
  label: string;
}

export function buildDefaultTimeScope(): DashboardTimeScope {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
  return createDashboardTimeScope(toDateTimeLocal(oneHourAgo.toISOString()), toDateTimeLocal(now.toISOString()), false);
}

export function createDashboardTimeScope(startTime: string, endTime: string, isCustom: boolean): DashboardTimeScope {
  const startMs = toMs(startTime);
  const endMs = toMs(endTime);
  const normalizedStartTime = Number.isFinite(startMs) && Number.isFinite(endMs) && startMs > endMs ? endTime : startTime;
  const normalizedEndTime = Number.isFinite(startMs) && Number.isFinite(endMs) && startMs > endMs ? startTime : endTime;

  return {
    startTime: normalizedStartTime,
    endTime: normalizedEndTime,
    isCustom,
    label: buildTimeScopeLabel(normalizedStartTime, normalizedEndTime, isCustom),
  };
}

export function buildTimeScopeLabel(startTime: string, endTime: string, isCustom = false): string {
  const start = formatScopeDate(startTime);
  const end = formatScopeDate(endTime);
  const prefix = isCustom ? 'Finestra selezionata' : 'Finestra attiva';
  return `${prefix}: ${start} → ${end}`;
}

export function formatScopeDate(value: string): string {
  const iso = toIso(value);
  if (!iso) {
    return 'n/d';
  }
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getTimeScopeMinutes(scope: DashboardTimeScope): number {
  const startMs = toMs(scope.startTime);
  const endMs = toMs(scope.endTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 60;
  }
  return Math.max(1, Math.round((endMs - startMs) / 60000));
}

export function toDateTimeLocal(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const pad = (amount: number) => String(amount).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function toIso(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function toMs(value: string | null | undefined): number {
  const iso = toIso(value);
  return iso ? new Date(iso).getTime() : Number.NaN;
}
