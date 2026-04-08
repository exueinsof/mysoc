export interface HealthResponse {
  status: string;
  service: string;
}

export interface GeoIpStatus {
  provider: string;
  mmdb_exists: boolean;
  geocoded_events: number;
  mmdb_path: string;
}

export interface CountItem {
  value: string;
  count: number;
}

export interface TopStatsResponse {
  field: string;
  items: CountItem[];
}

export interface IpDetailResponse {
  ip: string;
  total_seen: number;
  country: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  first_seen: string | null;
  last_seen: string | null;
  top_destinations: CountItem[];
  top_ports: CountItem[];
  flows: CountItem[];
  actions: CountItem[];
}

export interface CatalogMetric {
  name: string;
  label: string;
  description: string;
}

export interface CatalogsResponse {
  subnet_scopes: string[];
  alert_metrics: string[];
  supported_alert_metrics: CatalogMetric[];
}

export interface SubnetConfig {
  id?: number | null;
  name: string;
  cidr: string;
  scope: string;
  enabled: boolean;
}

export interface AlertConfig {
  id?: number | null;
  name: string;
  metric: string;
  threshold: number;
  window_seconds: number;
  enabled: boolean;
}

export interface LogsQuery {
  minutes?: number;
  start_time?: string;
  end_time?: string;
  limit?: number;
  offset?: number;
  time_filter?: string;
  flow_filter?: string;
  action_filter?: string;
  source_filter?: string;
  destination_filter?: string;
  classes_filter?: string;
  protocol_filter?: string;
  geo_filter?: string;
  summary_filter?: string;
}

export interface LogEntry {
  id: string;
  observed_at: string | null;
  ingested_at: string | null;
  summary: string | null;
  action: string | null;
  event_outcome: string | null;
  interface: string | null;
  protocol: string | null;
  source_ip: string | null;
  source_port: number | null;
  destination_ip: string | null;
  destination_port: number | null;
  classes: string[];
  traffic_flow: string | null;
  network_direction: string | null;
  source_country: string | null;
  source_city: string | null;
  raw_message: string | null;
  parse_error: string | null;
}

export interface LogsResponse {
  items: LogEntry[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export type TimelineTrackBy = 'event' | 'source_ip' | 'destination_ip' | 'destination_port' | 'traffic_flow' | 'action';

export interface TimelineEvent {
  id: string;
  time: string;
  track: string;
  summary: string | null;
  action: string | null;
  source_ip: string | null;
  destination_ip: string | null;
  destination_port: number | null;
  traffic_flow: string | null;
  raw_message: string | null;
}

export interface TimelineResponse {
  track_by: TimelineTrackBy;
  min_time: string | null;
  max_time: string | null;
  window_total: number;
  limit: number;
  truncated: boolean;
  events: TimelineEvent[];
}

export interface TimelineRowPayload {
  id: string;
  track_key: TimelineTrackBy;
  label: string;
  value?: string | null;
  aggregated: boolean;
}

export interface TimelinePoint {
  row_id: string;
  row_label: string;
  track_key: TimelineTrackBy;
  bucket_time: string;
  count: number;
}

export interface TimelineOverviewResponse {
  rows: TimelineRowPayload[];
  points: TimelinePoint[];
  requested_start: string | null;
  requested_end: string | null;
  absolute_min_time: string | null;
  absolute_max_time: string | null;
  bucket_seconds: number;
  bucket_label: string;
  initial_visible_start: string | null;
  initial_visible_end: string | null;
  buffer_cap: number;
}

export interface TimelineDetailResponse {
  mode: 'events' | 'aggregate';
  start_time: string;
  end_time: string;
  events_total: number;
  bucket_seconds?: number;
  bucket_label?: string;
  points: TimelinePoint[];
  events: TimelineEvent[];
  buffer_cap: number | null;
  truncated: boolean;
}

export interface MapPoint {
  source_ip: string;
  source_port: number | null;
  destination_ip: string;
  destination_port: number | null;
  country: string | null;
  city: string | null;
  lat: number;
  lon: number;
  count: number;
}

export interface MapResponse {
  requested_start: string;
  requested_end: string;
  truncated: boolean;
  points: MapPoint[];
}

export type GraphCategory = 'source' | 'destination' | 'service';

export interface GraphNode {
  id: string;
  name: string;
  category: GraphCategory;
  kind?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  value: number;
  label?: string;
}

export interface GraphResponse {
  requested_start: string;
  requested_end: string;
  truncated: boolean;
  directed: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface OllamaModelsResponse {
  models: string[];
}

export interface AnalyzePayload {
  model: string;
  prompt: string;
  minutes?: number;
  categories?: string[];
  start_time?: string;
  end_time?: string;
}

export type RealtimeTopic = 'dashboard' | 'logs' | 'timeline' | 'map' | 'graph' | 'alerts';

export interface RealtimeConnectedMessage {
  type: 'connected' | 'subscribed';
  topics: string[];
  timestamp?: string;
}

export interface RealtimePongMessage {
  type: 'pong';
  timestamp: string;
}

export interface RealtimeErrorMessage {
  type: 'error';
  message: string;
}

export interface RealtimeIngestionBatchMessage {
  type: 'ingestion_batch';
  count: number;
  timestamp: string;
  latest_logs: LogEntry[];
}

export type RealtimeMessage =
  | RealtimeConnectedMessage
  | RealtimePongMessage
  | RealtimeErrorMessage
  | RealtimeIngestionBatchMessage;

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';
