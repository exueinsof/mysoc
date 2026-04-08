import type {
  AlertConfig,
  AnalyzePayload,
  CatalogsResponse,
  GeoIpStatus,
  GraphResponse,
  HealthResponse,
  IpDetailResponse,
  LogsQuery,
  LogsResponse,
  MapResponse,
  OllamaModelsResponse,
  SubnetConfig,
  TimelineDetailResponse,
  TimelineOverviewResponse,
  TimelineResponse,
  TopStatsResponse,
} from './types';

const API_PREFIX = import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(init?.headers ?? {}),
  };

  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new ApiError(bodyText || `${response.status} ${response.statusText}`, response.status);
  }

  return (await response.json()) as T;
}

function buildQuery<T extends object>(query: T): string {
  const params = new URLSearchParams();
  Object.entries(query as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
    }
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export function getHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health');
}

export function getGeoIpStatus(): Promise<GeoIpStatus> {
  return requestJson<GeoIpStatus>('/system/geoip-status');
}

export function getCatalogs(): Promise<CatalogsResponse> {
  return requestJson<CatalogsResponse>('/system/catalogs');
}

export function getOllamaModels(): Promise<OllamaModelsResponse> {
  return requestJson<OllamaModelsResponse>('/system/ollama-models');
}

export function getTopStats(
  field: string,
  query: {
    minutes?: number;
    start_time?: string;
    end_time?: string;
    limit?: number;
  } = {},
): Promise<TopStatsResponse> {
  return requestJson<TopStatsResponse>(`/dashboard/top${buildQuery({ field, minutes: 1440, limit: 10, ...query })}`);
}

export function getIpDetail(
  ip: string,
  query: {
    minutes?: number;
    start_time?: string;
    end_time?: string;
  } = {},
): Promise<IpDetailResponse> {
  return requestJson<IpDetailResponse>(`/dashboard/ip-detail${buildQuery({ ip, minutes: 1440, ...query })}`);
}

export function getTimeline(query: {
  minutes?: number;
  track_by?: string;
  start_time?: string;
  end_time?: string;
  limit?: number;
} = {}): Promise<TimelineResponse> {
  return requestJson<TimelineResponse>(`/dashboard/timeline${buildQuery(query)}`);
}

export function postTimelineOverview(payload: {
  minutes?: number;
  start_time?: string | null;
  end_time?: string | null;
  tracks: string[];
  collapsed_groups: string[];
  max_rows_per_group?: number;
}): Promise<TimelineOverviewResponse> {
  return requestJson<TimelineOverviewResponse>('/dashboard/timeline/overview', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function postTimelineDetail(payload: {
  start_time: string;
  end_time: string;
  rows: Array<{
    id: string;
    track_key: string;
    label: string;
    value?: string | null;
    aggregated: boolean;
  }>;
}): Promise<TimelineDetailResponse> {
  return requestJson<TimelineDetailResponse>('/dashboard/timeline/detail', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getMapData(query: {
  minutes?: number;
  start_time?: string;
  end_time?: string;
  limit?: number;
} = {}): Promise<MapResponse> {
  return requestJson<MapResponse>(`/dashboard/map${buildQuery(query)}`);
}

export function getGraphData(query: {
  minutes?: number;
  start_time?: string;
  end_time?: string;
  limit?: number;
} = {}): Promise<GraphResponse> {
  return requestJson<GraphResponse>(`/dashboard/graph${buildQuery(query)}`);
}

export async function streamAiAnalysis(payload: AnalyzePayload, onChunk: (chunk: string) => void): Promise<void> {
  const response = await fetch(`${API_PREFIX}/ai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    const bodyText = await response.text();
    throw new ApiError(bodyText || `${response.status} ${response.statusText}`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    onChunk(decoder.decode(value, { stream: true }));
  }

  const tail = decoder.decode();
  if (tail) {
    onChunk(tail);
  }
}

export function getLogs(query: LogsQuery = {}): Promise<LogsResponse> {
  return requestJson<LogsResponse>(`/dashboard/logs${buildQuery(query)}`);
}

export function getSubnets(): Promise<SubnetConfig[]> {
  return requestJson<SubnetConfig[]>('/config/subnets');
}

export function saveSubnets(items: SubnetConfig[]): Promise<{ updated: number }> {
  return requestJson<{ updated: number }>('/config/subnets', {
    method: 'PUT',
    body: JSON.stringify(
      items.map(({ name, cidr, scope, enabled }) => ({
        name,
        cidr,
        scope,
        enabled,
      })),
    ),
  });
}

export function getAlerts(): Promise<AlertConfig[]> {
  return requestJson<AlertConfig[]>('/config/alerts');
}

export function saveAlerts(items: AlertConfig[]): Promise<{ updated: number }> {
  return requestJson<{ updated: number }>('/config/alerts', {
    method: 'PUT',
    body: JSON.stringify(
      items.map(({ name, metric, threshold, window_seconds, enabled }) => ({
        name,
        metric,
        threshold,
        window_seconds,
        enabled,
      })),
    ),
  });
}

export function getScopes(): Promise<Array<{ id: number; name: string }>> {
  return requestJson<Array<{ id: number; name: string }>>('/config/scopes');
}

export function saveScopes(names: string[]): Promise<{ updated: number }> {
  return requestJson<{ updated: number }>('/config/scopes', {
    method: 'PUT',
    body: JSON.stringify(names.map((name) => ({ name }))),
  });
}

export function getMetrics(): Promise<Array<{ id: number; name: string }>> {
  return requestJson<Array<{ id: number; name: string }>>('/config/metrics');
}

export function saveMetrics(names: string[]): Promise<{ updated: number }> {
  return requestJson<{ updated: number }>('/config/metrics', {
    method: 'PUT',
    body: JSON.stringify(names.map((name) => ({ name }))),
  });
}
