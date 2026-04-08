import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
  getAlerts,
  getCatalogs,
  getMetrics,
  getScopes,
  getSubnets,
  saveAlerts,
  saveMetrics,
  saveScopes,
  saveSubnets,
} from '../../lib/api/client';
import type { AlertConfig, CatalogsResponse, SubnetConfig } from '../../lib/api/types';

interface ConfigPanelProps {
  embedded?: boolean;
}

export function ConfigPanel({ embedded = false }: ConfigPanelProps) {
  const [subnets, setSubnets] = useState<SubnetConfig[]>([]);
  const [alerts, setAlerts] = useState<AlertConfig[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogsResponse | null>(null);
  const [scopesText, setScopesText] = useState<string>('');
  const [metricsText, setMetricsText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const [loadedSubnets, loadedAlerts, loadedCatalogs, scopes, metrics] = await Promise.all([
        getSubnets(),
        getAlerts(),
        getCatalogs(),
        getScopes(),
        getMetrics(),
      ]);
      setSubnets(loadedSubnets);
      setAlerts(loadedAlerts);
      setCatalogs(loadedCatalogs);
      setScopesText(scopes.map((item) => item.name).join('\n'));
      setMetricsText(metrics.map((item) => item.name).join('\n'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Errore caricamento config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const supportedMetricNames = useMemo(
    () => (catalogs?.supported_alert_metrics ?? []).map((item) => item.name),
    [catalogs?.supported_alert_metrics],
  );

  async function handleSaveAll() {
    setSaving(true);
    setMessage('Salvataggio in corso…');
    try {
      await Promise.all([
        saveSubnets(subnets),
        saveAlerts(alerts),
        saveScopes(normalizeMultiline(scopesText)),
        saveMetrics(normalizeMultiline(metricsText)),
      ]);
      setMessage('Configurazione aggiornata con successo.');
      await loadConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Salvataggio fallito');
    } finally {
      setSaving(false);
    }
  }

  const runtimeSection = (
    <>
      <div className="panel__header">
        <div>
          <h2 className="panel__title">Soglie operative</h2>
          <p className="panel__subtitle">Subnets, alert thresholds, scopes e metriche operative del SOC.</p>
        </div>
        <div className="actions">
          <button className="button" type="button" onClick={() => void loadConfig()}>
            Ricarica
          </button>
          <button className="button button--primary" type="button" onClick={() => void handleSaveAll()} disabled={saving || loading}>
            {saving ? 'Salvo…' : 'Salva tutto'}
          </button>
        </div>
      </div>

      {loading ? <div className="empty-state">Caricamento configurazione…</div> : null}

      <div className="panel-grid">
        <div>
          <div className="panel__header">
            <div>
              <h3 className="panel__title">Subnets</h3>
            </div>
            <button
              className="button"
              type="button"
              onClick={() => setSubnets((current) => [...current, { name: '', cidr: '', scope: 'internal', enabled: true }])}
            >
              + Riga
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>CIDR</th>
                  <th>Scope</th>
                  <th>Enabled</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {subnets.map((row, index) => (
                  <tr key={`subnet-${index}`}>
                    <td><input className="input" title="Subnet name" placeholder="Name" value={row.name} onChange={(event) => updateSubnet(index, 'name', event.target.value, setSubnets)} /></td>
                    <td><input className="input code" title="Subnet CIDR" placeholder="CIDR" value={row.cidr} onChange={(event) => updateSubnet(index, 'cidr', event.target.value, setSubnets)} /></td>
                    <td><input className="input" title="Subnet scope" placeholder="Scope" value={row.scope} onChange={(event) => updateSubnet(index, 'scope', event.target.value, setSubnets)} list="scope-options" /></td>
                    <td><input title="Subnet enabled" type="checkbox" checked={row.enabled} onChange={(event) => updateSubnet(index, 'enabled', event.target.checked, setSubnets)} /></td>
                    <td><button className="button button--danger" type="button" onClick={() => removeRow(index, setSubnets)}>Rimuovi</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="panel__header">
            <div>
              <h3 className="panel__title">Alerts</h3>
            </div>
            <button
              className="button"
              type="button"
              onClick={() =>
                setAlerts((current) => [
                  ...current,
                  {
                    name: '',
                    metric: supportedMetricNames[0] ?? 'blocked_connections_per_source_ip',
                    threshold: 50,
                    window_seconds: 60,
                    enabled: true,
                  },
                ])
              }
            >
              + Riga
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Metric</th>
                  <th>Threshold</th>
                  <th>Window</th>
                  <th>Enabled</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((row, index) => (
                  <tr key={`alert-${index}`}>
                    <td><input className="input" title="Alert name" placeholder="Name" value={row.name} onChange={(event) => updateAlert(index, 'name', event.target.value, setAlerts)} /></td>
                    <td><input className="input" title="Alert metric" placeholder="Metric" value={row.metric} onChange={(event) => updateAlert(index, 'metric', event.target.value, setAlerts)} list="metric-options" /></td>
                    <td><input className="input" title="Alert threshold" type="number" value={row.threshold} onChange={(event) => updateAlert(index, 'threshold', Number(event.target.value || 0), setAlerts)} /></td>
                    <td><input className="input" title="Alert window" type="number" value={row.window_seconds} onChange={(event) => updateAlert(index, 'window_seconds', Number(event.target.value || 0), setAlerts)} /></td>
                    <td><input title="Alert enabled" type="checkbox" checked={row.enabled} onChange={(event) => updateAlert(index, 'enabled', event.target.checked, setAlerts)} /></td>
                    <td><button className="button button--danger" type="button" onClick={() => removeRow(index, setAlerts)}>Rimuovi</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );

  const catalogsSection = (
    <>
      <div className="panel__header">
        <div>
          <h2 className="panel__title">Cataloghi e scope</h2>
          <p className="panel__subtitle">Editor rapido per scopes e metric catalog.</p>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label>Scopes (uno per riga)</label>
          <textarea className="textarea" title="Scopes list" value={scopesText} onChange={(event) => setScopesText(event.target.value)} />
        </div>
        <div className="field">
          <label>Metrics (una per riga)</label>
          <textarea className="textarea" title="Metrics list" value={metricsText} onChange={(event) => setMetricsText(event.target.value)} />
        </div>
      </div>

      <div className="panel__header panel__header--spaced">
        <div>
          <h3 className="panel__title">Supported alert metrics</h3>
        </div>
      </div>
      <div className="list">
        {(catalogs?.supported_alert_metrics ?? []).map((metric) => (
          <div className="list-item" key={metric.name}>
            <div className="row-stack">
              <strong>{metric.label}</strong>
              <span className="muted">{metric.description}</span>
            </div>
            <span className="tag code">{metric.name}</span>
          </div>
        ))}
      </div>

      {message ? <p className="note">{message}</p> : null}
    </>
  );

  return (
    <>
      <div className={embedded ? 'panel-grid' : 'app-section grid gap-4 lg:grid-cols-[1.12fr_0.88fr]'}>
        <section className={embedded ? 'panel-card panel-scroll' : 'panel-card'}>{runtimeSection}</section>
        <section className={embedded ? 'panel-card panel-scroll' : 'panel-card'}>{catalogsSection}</section>
      </div>

      <datalist id="scope-options">
        {(catalogs?.subnet_scopes ?? []).map((scope) => <option key={scope} value={scope} />)}
      </datalist>
      <datalist id="metric-options">
        {supportedMetricNames.map((metric) => <option key={metric} value={metric} />)}
      </datalist>
    </>
  );
}

function normalizeMultiline(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function removeRow<T>(index: number, setter: Dispatch<SetStateAction<T[]>>) {
  setter((current) => current.filter((_, rowIndex) => rowIndex !== index));
}

function updateSubnet<K extends keyof SubnetConfig>(
  index: number,
  field: K,
  value: SubnetConfig[K],
  setter: Dispatch<SetStateAction<SubnetConfig[]>>,
) {
  setter((current) => current.map((item, rowIndex) => (rowIndex === index ? { ...item, [field]: value } : item)));
}

function updateAlert<K extends keyof AlertConfig>(
  index: number,
  field: K,
  value: AlertConfig[K],
  setter: Dispatch<SetStateAction<AlertConfig[]>>,
) {
  setter((current) => current.map((item, rowIndex) => (rowIndex === index ? { ...item, [field]: value } : item)));
}
