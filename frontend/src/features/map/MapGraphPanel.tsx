import 'leaflet/dist/leaflet.css';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';

import { getGraphData, getMapData } from '../../lib/api/client';
import type { GraphCategory, GraphNode, GraphResponse, MapPoint, MapResponse, RealtimeMessage } from '../../lib/api/types';
import { useRealtime } from '../../lib/realtime/client';
import type { DashboardTimeScope } from '../../lib/timeScope';
import { toIso } from '../../lib/timeScope';

const allCategories: GraphCategory[] = ['source', 'destination', 'service'];
const LeafletMapContainer = MapContainer as unknown as React.ComponentType<Record<string, unknown>>;
const LeafletTileLayer = TileLayer as unknown as React.ComponentType<Record<string, unknown>>;
const LeafletCircleMarker = CircleMarker as unknown as React.ComponentType<Record<string, unknown>>;

type GraphMode = 'force' | 'sankey' | 'circular' | 'layers';

interface MapGraphPanelProps {
  timeScope: DashboardTimeScope;
}

export function MapGraphPanel({ timeScope }: MapGraphPanelProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [mapData, setMapData] = useState<MapResponse | null>(null);
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [graphMode, setGraphMode] = useState<GraphMode>('force');
  const [graphCategories, setGraphCategories] = useState<GraphCategory[]>(allCategories);
  const [isGraphFullscreen, setIsGraphFullscreen] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [minEdgeWeight, setMinEdgeWeight] = useState<number>(1);
  const [maxNodes, setMaxNodes] = useState<number>(60);
  const [showServiceNodes, setShowServiceNodes] = useState<boolean>(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const startIso = toIso(timeScope.startTime);
      const endIso = toIso(timeScope.endTime);
      const [nextMap, nextGraph] = await Promise.all([
        getMapData({ start_time: startIso, end_time: endIso, minutes: startIso && endIso ? undefined : 60, limit: 150 }),
        getGraphData({ start_time: startIso, end_time: endIso, minutes: startIso && endIso ? undefined : 60, limit: 180 }),
      ]);
      setMapData(nextMap);
      setGraphData(nextGraph);
      setSelectedPoint((current) => {
        if (!current) {
          return nextMap.points[0] ?? null;
        }
        return nextMap.points.find((point) => isSameMapPoint(point, current)) ?? nextMap.points[0] ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Errore caricamento geomappa/grafo');
    } finally {
      setLoading(false);
    }
  }, [timeScope.endTime, timeScope.startTime]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRealtime = useCallback(
    (message: RealtimeMessage) => {
      if (message.type === 'ingestion_batch') {
        void loadData();
      }
    },
    [loadData],
  );

  useRealtime(['map', 'graph'], handleRealtime);

  const filteredGraph = useMemo(
    () => prepareGraphData(graphData, {
      categories: graphCategories,
      searchTerm,
      minEdgeWeight,
      maxNodes,
      showServiceNodes,
    }),
    [graphCategories, graphData, maxNodes, minEdgeWeight, searchTerm, showServiceNodes],
  );

  useEffect(() => {
    setSelectedNode((current) => (current && filteredGraph.nodes.some((node) => node.id === current.id) ? current : null));
  }, [filteredGraph.nodes]);

  const graphOption = useMemo<EChartsOption>(() => buildGraphOption(filteredGraph.nodes, filteredGraph.edges, graphMode), [filteredGraph.edges, filteredGraph.nodes, graphMode]);

  const mapCenter: [number, number] = selectedPoint ? [selectedPoint.lat, selectedPoint.lon] : [22, 10];
  const maxEdgeValue = useMemo(() => Math.max(1, ...((graphData?.edges ?? []).map((edge) => edge.value))), [graphData?.edges]);

  function toggleCategory(category: GraphCategory) {
    setGraphCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    );
  }

  return (
    <div className="app-section">
      <section className="panel-card panel-scroll">
        <div className="panel-header">
          <div>
            <h2>Geomappa e grafo di rete</h2>
            <p>Mappa geografica e traffico relazionale sincronizzati con la finestra timeline attiva.</p>
            <div className="panel__subtitle">{timeScope.label}</div>
          </div>
          <div className="actions">
            <button className="btn-primary" type="button" onClick={() => void loadData()}>
              Aggiorna
            </button>
          </div>
        </div>

        <div className="form-grid stack-gap-bottom lg:grid-cols-[repeat(4,minmax(0,1fr))]">
          <div className="field">
            <label>Vista grafo</label>
            <select className="select" title="Vista grafo" value={graphMode} onChange={(event) => setGraphMode(event.target.value as GraphMode)}>
              <option value="force">Topology</option>
              <option value="sankey">Sankey</option>
              <option value="circular">Chord-like</option>
              <option value="layers">Hierarchical</option>
            </select>
          </div>
          <div className="field">
            <label>Filtro IP / porta</label>
            <input className="input" title="Filtro grafo" placeholder="Es. 10.0.0.20 o 443" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
          </div>
          <div className="field">
            <label>Peso minimo edge ({minEdgeWeight})</label>
            <input className="input" title="Peso minimo edge" type="range" min={1} max={maxEdgeValue} value={minEdgeWeight} onChange={(event) => setMinEdgeWeight(Number(event.target.value || 1))} />
          </div>
          <div className="field">
            <label>Top nodi</label>
            <select className="select" title="Top nodi" value={String(maxNodes)} onChange={(event) => setMaxNodes(Number(event.target.value || 60))}>
              <option value="24">24</option>
              <option value="48">48</option>
              <option value="60">60</option>
              <option value="96">96</option>
              <option value="999">Tutti</option>
            </select>
          </div>
        </div>

        <div className="actions stack-gap-bottom">
          <button className={showServiceNodes ? 'btn-primary' : 'btn-secondary'} type="button" onClick={() => setShowServiceNodes((current) => !current)}>
            {showServiceNodes ? 'Vista completa socket' : 'Vista compatta per IP'}
          </button>
          {allCategories.map((category) => (
            <button key={category} className={graphCategories.includes(category) ? 'btn-primary' : 'btn-secondary'} type="button" onClick={() => toggleCategory(category)}>
              {category}
            </button>
          ))}
          <span className="badge">Punti mappa {mapData?.points.length ?? 0}</span>
          <span className="badge">Nodi {filteredGraph.nodes.length}</span>
          <span className="badge">Edge {filteredGraph.edges.length}</span>
        </div>

        {loading ? <div className="empty-state">Caricamento mappa e grafo…</div> : null}
        {error ? <div className="empty-state">{error}</div> : null}

        {!loading && !error ? (
          <div className="map-graph-grid">
            {!isGraphFullscreen ? (
              <div className="panel-card panel--nested">
                <div className="panel__header">
                  <div>
                    <h3 className="panel__title">Geomappa</h3>
                    <p className="panel__subtitle">Ingressi geolocalizzati da traffico `external_to_internal`.</p>
                  </div>
                </div>
                <>
                  <div id="worldMap" className="chart-frame">
                    <LeafletMapContainer key={`${mapCenter[0]}-${mapCenter[1]}-${mapData?.points.length ?? 0}`} center={mapCenter} zoom={2} scrollWheelZoom className="map-canvas map-canvas--full">
                      <LeafletTileLayer attribution='&copy; OpenStreetMap' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      {(mapData?.points ?? []).map((point) => (
                        <LeafletCircleMarker
                          key={`${point.source_ip}-${point.destination_ip}-${point.destination_port}-${point.lat}-${point.lon}`}
                          center={[point.lat, point.lon]}
                          radius={Math.min(18, 6 + Math.max(0, point.count - 1))}
                          pathOptions={{ color: '#f8fafc', fillColor: '#ef4444', fillOpacity: 0.75, weight: 2 }}
                          eventHandlers={{ click: () => setSelectedPoint(point) }}
                        >
                          <Popup>
                            <strong>{point.source_ip}</strong>
                            <br />
                            {point.country ?? 'n/a'} / {point.city ?? 'n/a'}
                            <br />
                            {point.destination_ip}:{point.destination_port ?? 'n/a'}
                          </Popup>
                        </LeafletCircleMarker>
                      ))}
                    </LeafletMapContainer>
                  </div>
                  <div className="detail-card">
                    <strong>{selectedPoint?.source_ip ?? (mapData?.points.length ? 'Seleziona un punto' : 'Nessun punto geolocalizzato')}</strong>
                    <div className="muted">
                      {selectedPoint
                        ? `${selectedPoint.country ?? 'n/a'} / ${selectedPoint.city ?? 'n/a'} • ${selectedPoint.count} eventi`
                        : (mapData?.points.length
                            ? 'Clicca un marker per il dettaglio.'
                            : 'Nessun punto geolocalizzato nella finestra selezionata.')}
                    </div>
                    {selectedPoint ? (
                      <div className="row-stack stack-gap-top-sm">
                        <span>Coordinates: {selectedPoint.lat}, {selectedPoint.lon}</span>
                        <span>Destination: {selectedPoint.destination_ip}:{selectedPoint.destination_port ?? 'n/a'}</span>
                      </div>
                    ) : null}
                  </div>
                </>
              </div>
            ) : null}

            <div className={`panel-card panel--nested ${isGraphFullscreen ? 'graph-panel-fullscreen' : ''}`}>
              <div className="panel__header">
                <div>
                  <h3 className="panel__title">Grafo di rete</h3>
                  <p className="panel__subtitle">Vista relazionale della rete con filtri e modalità selezionabili.</p>
                </div>
                <button className="btn-secondary" type="button" onClick={() => setIsGraphFullscreen((current) => !current)}>
                  {isGraphFullscreen ? 'Riduci grafo' : 'Espandi grafo'}
                </button>
              </div>
              <div id="graphChart" className="chart-frame">
                <ReactECharts option={graphOption} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate onEvents={{ click: (params: { data?: Record<string, unknown> }) => handleNodeClick(params, setSelectedNode) }} />
              </div>
              {selectedNode ? (
                <div className="detail-card">
                  <strong>{selectedNode.name}</strong>
                  <div className="muted">{explainNode(selectedNode)}</div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function handleNodeClick(
  params: { data?: Record<string, unknown> },
  onSelect: (node: GraphNode | null) => void,
) {
  const raw = params.data;
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    onSelect(null);
    return;
  }
  const category = typeof raw.categoryName === 'string' ? raw.categoryName : 'service';
  onSelect({
    id: raw.id,
    name: raw.name,
    category: category as GraphCategory,
    kind: typeof raw.kind === 'string' ? raw.kind : undefined,
  });
}

function explainNode(node: GraphNode): string {
  if (node.category === 'source') {
    return `${node.name} è un nodo sorgente: indica l'host che origina i flussi osservati.`;
  }
  if (node.category === 'destination') {
    return `${node.name} è un nodo destinazione: evidenzia l'asset verso cui convergono i flussi.`;
  }
  if (node.kind === 'collapsed_flow') {
    return `${node.name} rappresenta un collegamento aggregato in vista compatta.`;
  }
  return `${node.name} è un nodo socket/servizio ${node.kind ?? ''}`.trim();
}

function prepareGraphData(
  graphData: GraphResponse | null,
  options: {
    categories: GraphCategory[];
    searchTerm: string;
    minEdgeWeight: number;
    maxNodes: number;
    showServiceNodes: boolean;
  },
): { nodes: GraphNode[]; edges: GraphResponse['edges'] } {
  const sourceNodes = graphData?.nodes ?? [];
  const sourceEdges = graphData?.edges ?? [];
  const shouldCollapseToHosts = !options.showServiceNodes || !options.categories.includes('service');
  const baseGraph = shouldCollapseToHosts ? collapseToIpGraph(sourceNodes, sourceEdges) : { nodes: sourceNodes, edges: sourceEdges };

  const allowed = new Set(options.categories);
  let nodes = baseGraph.nodes.filter((node) => allowed.has(node.category));
  let nodeIds = new Set(nodes.map((node) => node.id));
  let edges = baseGraph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.value >= options.minEdgeWeight);

  if (options.searchTerm.trim()) {
    const normalized = options.searchTerm.trim().toLowerCase();
    const matchedIds = new Set(
      nodes
        .filter((node) => node.name.toLowerCase().includes(normalized))
        .map((node) => node.id),
    );

    if (!matchedIds.size) {
      return { nodes: [], edges: [] };
    }

    const connectedIds = new Set<string>(matchedIds);
    edges = edges.filter((edge) => matchedIds.has(edge.source) || matchedIds.has(edge.target));
    edges.forEach((edge) => {
      connectedIds.add(edge.source);
      connectedIds.add(edge.target);
    });
    nodes = nodes.filter((node) => connectedIds.has(node.id));
  }

  if (options.maxNodes > 0 && nodes.length > options.maxNodes) {
    const nodeScores = buildNodeScores(edges);
    const topNodeIds = new Set(
      [...nodes]
        .sort((left, right) => (nodeScores.get(right.id) ?? 0) - (nodeScores.get(left.id) ?? 0))
        .slice(0, options.maxNodes)
        .map((node) => node.id),
    );
    edges = edges.filter((edge) => topNodeIds.has(edge.source) && topNodeIds.has(edge.target));
    nodeIds = new Set<string>();
    edges.forEach((edge) => {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    });
    nodes = nodes.filter((node) => nodeIds.has(node.id));
  }

  return { nodes, edges };
}

function collapseToIpGraph(nodes: GraphNode[], edges: GraphResponse['edges']): { nodes: GraphNode[]; edges: GraphResponse['edges'] } {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceSocketToHost = new Map<string, string>();
  const destinationSocketToHost = new Map<string, string>();

  edges.forEach((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (sourceNode?.category === 'source' && targetNode?.kind === 'source_socket') {
      sourceSocketToHost.set(edge.target, edge.source);
    }
    if (sourceNode?.kind === 'destination_socket' && targetNode?.category === 'destination') {
      destinationSocketToHost.set(edge.source, edge.target);
    }
  });

  const aggregated = new Map<string, number>();
  edges.forEach((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (sourceNode?.kind !== 'source_socket' || targetNode?.kind !== 'destination_socket') {
      return;
    }
    const sourceHost = sourceSocketToHost.get(edge.source) ?? edge.source.split(':')[0] ?? edge.source;
    const destinationHost = destinationSocketToHost.get(edge.target) ?? edge.target.split(':')[0] ?? edge.target;
    const key = `${sourceHost}__${destinationHost}`;
    aggregated.set(key, (aggregated.get(key) ?? 0) + edge.value);
  });

  return {
    nodes: nodes.filter((node) => node.category !== 'service'),
    edges: [...aggregated.entries()].map(([key, value]) => {
      const [source, target] = key.split('__');
      return {
        source,
        target,
        value,
        label: `${source} → ${target}`,
      };
    }),
  };
}

function buildNodeScores(edges: GraphResponse['edges']): Map<string, number> {
  const scores = new Map<string, number>();
  edges.forEach((edge) => {
    scores.set(edge.source, (scores.get(edge.source) ?? 0) + edge.value);
    scores.set(edge.target, (scores.get(edge.target) ?? 0) + edge.value);
  });
  return scores;
}

function buildSankeyData(
  nodes: Array<Record<string, unknown>>,
  edges: GraphResponse['edges'],
): {
  nodes: Array<Record<string, unknown>>;
  links: Array<{ source: string; target: string; value: number }>;
} {
  const nodeById = new Map(nodes.map((node) => [String(node.id ?? ''), node]));
  const hostRoles = inferSankeyHostRoles(nodeById, edges);
  const aggregatedLinks = new Map<string, number>();

  edges.forEach((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode || edge.source === edge.target) {
      return;
    }

    let sourceId = edge.source;
    let targetId = edge.target;
    const sourceRank = resolveSankeyNodeRank(sourceNode, hostRoles.get(sourceId));
    const targetRank = resolveSankeyNodeRank(targetNode, hostRoles.get(targetId));

    if (sourceRank > targetRank || (sourceRank === targetRank && sourceId.localeCompare(targetId) > 0)) {
      [sourceId, targetId] = [targetId, sourceId];
    }

    const key = `${sourceId}__${targetId}`;
    aggregatedLinks.set(key, (aggregatedLinks.get(key) ?? 0) + edge.value);
  });

  const links = [...aggregatedLinks.entries()].map(([key, value]) => {
    const separatorIndex = key.indexOf('__');
    return {
      source: key.slice(0, separatorIndex),
      target: key.slice(separatorIndex + 2),
      value,
    };
  });

  const linkedNodeIds = new Set(links.flatMap((link) => [link.source, link.target]));
  const sankeyNodes = nodes
    .filter((node) => linkedNodeIds.has(String(node.id ?? '')))
    .map((node) => ({
      ...node,
      depth: resolveSankeyNodeRank(node, hostRoles.get(String(node.id ?? ''))),
      label: { color: '#e2e8f0', fontSize: 11 },
    }));

  return { nodes: sankeyNodes, links };
}

function inferSankeyHostRoles(
  nodeById: Map<string, Record<string, unknown>>,
  edges: GraphResponse['edges'],
): Map<string, 'source' | 'destination'> {
  const hostRoles = new Map<string, 'source' | 'destination'>();

  edges.forEach((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);

    if (String(targetNode?.kind ?? '') === 'source_socket') {
      hostRoles.set(edge.source, 'source');
    }
    if (String(sourceNode?.kind ?? '') === 'destination_socket') {
      hostRoles.set(edge.target, 'destination');
    }
  });

  return hostRoles;
}

function resolveSankeyNodeRank(
  node: Record<string, unknown>,
  hintedRole?: 'source' | 'destination',
): number {
  const kind = String(node.kind ?? '');
  if (kind === 'source_socket') {
    return 1;
  }
  if (kind === 'destination_socket') {
    return 2;
  }
  if (hintedRole === 'source') {
    return 0;
  }
  if (hintedRole === 'destination') {
    return 3;
  }

  const category = String(node.categoryName ?? node.category ?? 'service');
  if (category === 'source') {
    return 0;
  }
  if (category === 'destination') {
    return 3;
  }
  return 1;
}

function buildGraphOption(nodes: GraphNode[], edges: GraphResponse['edges'], graphMode: GraphMode): EChartsOption {
  const categories = [{ name: 'source' }, { name: 'destination' }, { name: 'service' }];
  const categoryIndex = new Map(categories.map((item, index) => [item.name, index]));
  const palette: Record<GraphCategory, string> = {
    source: '#fca5a5',
    destination: '#93c5fd',
    service: '#c4b5fd',
  };
  const nodeScores = buildNodeScores(edges);

  const baseNodes = nodes.map((node) => {
    const score = nodeScores.get(node.id) ?? 1;
    return {
      ...node,
      value: score,
      category: categoryIndex.get(node.category) ?? 0,
      categoryName: node.category,
      symbolSize: Math.max(node.category === 'service' ? 18 : 24, Math.min(48, 16 + (Math.sqrt(score) * 4))),
      itemStyle: { color: palette[node.category] },
      label: { show: false },
    };
  });

  const sankeyData = graphMode === 'sankey' ? buildSankeyData(baseNodes, edges) : null;

  if (!baseNodes.length || (graphMode === 'sankey' && !(sankeyData?.links.length))) {
    return {
      backgroundColor: 'transparent',
      title: {
        text: 'Nessun dato di grafo disponibile nella finestra selezionata',
        left: 'center',
        top: 'middle',
        textStyle: { color: '#94a3b8', fontSize: 14 },
      },
      series: [],
    };
  }

  const graphLinks = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    value: edge.value,
    lineStyle: { width: Math.max(1, Math.min(8, 1 + edge.value)) },
  }));

  const sharedGraphSeries = {
    type: 'graph',
    roam: true,
    draggable: true,
    data: graphMode === 'layers' ? applyLayerPositions(baseNodes) : baseNodes,
    links: graphLinks,
    categories,
    emphasis: {
      focus: 'adjacency',
      label: {
        show: true,
        color: '#f8fafc',
        fontSize: 11,
        backgroundColor: 'rgba(15,23,42,0.88)',
        padding: [3, 6],
        borderRadius: 6,
      },
    },
    lineStyle: {
      color: 'rgba(148,163,184,0.38)',
      curveness: graphMode === 'circular' ? 0.35 : 0.18,
      opacity: 0.85,
    },
    edgeSymbol: ['none', 'arrow'],
    edgeSymbolSize: 6,
    label: { show: false },
  } as const;

  const series =
    graphMode === 'sankey' && sankeyData
      ? [
          {
            type: 'sankey',
            data: sankeyData.nodes,
            links: sankeyData.links,
            emphasis: { focus: 'adjacency' },
            draggable: true,
            nodeAlign: 'justify',
            nodeGap: 14,
            nodeWidth: 18,
            layoutIterations: 32,
            lineStyle: { color: 'gradient', curveness: 0.45, opacity: 0.5 },
            label: { color: '#e2e8f0', fontSize: 11 },
          },
        ]
      : [
          {
            ...sharedGraphSeries,
            layout: graphMode === 'layers' ? 'none' : graphMode === 'circular' ? 'circular' : 'force',
            force: graphMode === 'force' ? { repulsion: 200, edgeLength: [70, 150], gravity: 0.06 } : undefined,
            circular: graphMode === 'circular' ? { rotateLabel: true } : undefined,
          },
        ];

  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#e2e8f0', fontFamily: 'Inter, Segoe UI, sans-serif' },
    tooltip: {
      trigger: 'item',
      formatter: (params) => buildGraphTooltip(params as { dataType?: string; data?: Record<string, unknown> | null; value?: number | number[] }),
    },
    series: series as EChartsOption['series'],
  };
}

function applyLayerPositions(nodes: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const columnX: Record<string, number> = {
    source: 120,
    service: 420,
    destination: 720,
  };

  const grouped = nodes.reduce<Record<string, Array<Record<string, unknown>>>>((accumulator, node) => {
    const category = String(node.categoryName ?? 'service');
    accumulator[category] = [...(accumulator[category] ?? []), node];
    return accumulator;
  }, {});

  return Object.entries(grouped).flatMap(([category, items]) => {
    const ordered = [...items].sort((left, right) => Number(right.value ?? 0) - Number(left.value ?? 0));
    return ordered.map((node, index) => ({
      ...node,
      x: columnX[category] ?? 420,
      y: 80 + (index * 48),
      fixed: true,
    }));
  });
}

function buildGraphTooltip(params: { dataType?: string; data?: Record<string, unknown> | null; value?: number | number[] }): string {
  const raw = params.data ?? {};
  if (params.dataType === 'edge') {
    const source = String(raw.source ?? 'n/a');
    const target = String(raw.target ?? 'n/a');
    const value = Number(raw.value ?? params.value ?? 0);
    return `<strong>${source}</strong> → <strong>${target}</strong><br/>Flussi osservati: ${value}`;
  }

  const name = String(raw.name ?? 'n/a');
  const category = String(raw.categoryName ?? 'service');
  const kind = raw.kind ? `<br/>Ruolo: ${String(raw.kind)}` : '';
  const value = Number(raw.value ?? 0);
  return `<strong>${name}</strong><br/>Categoria: ${category}${kind}<br/>Peso: ${value}`;
}

function isSameMapPoint(left: MapPoint, right: MapPoint): boolean {
  return left.source_ip === right.source_ip
    && left.destination_ip === right.destination_ip
    && left.destination_port === right.destination_port
    && left.lat === right.lat
    && left.lon === right.lon;
}
