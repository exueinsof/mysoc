import { useEffect, useState } from 'react';

import { getOllamaModels, streamAiAnalysis } from '../../lib/api/client';
import type { DashboardTimeScope } from '../../lib/timeScope';
import { toIso } from '../../lib/timeScope';

const STORAGE_KEY = 'mysoc.savedPrompts';
const defaultPrompt =
  "Sei un analista cyber e forense. Analizza i log selezionati, evidenzia pattern sospetti, priorita', impatti e suggerisci azioni operative. Per gli IP source dammi i dettagli geografici. Descrivi i grafi source-destination.";

interface SavedPrompt {
  id: string;
  name: string;
  text: string;
}

interface AiPanelProps {
  timeScope: DashboardTimeScope;
}

export function AiPanel({ timeScope }: AiPanelProps) {
  const [models, setModels] = useState<string[]>(['llama3.1:8b']);
  const [model, setModel] = useState<string>('llama3.1:8b');
  const [prompt, setPrompt] = useState<string>(defaultPrompt);
  const [output, setOutput] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const payload = await getOllamaModels();
        const nextModels = payload.models?.length ? payload.models : ['llama3.1:8b'];
        setModels(nextModels);
        setModel((current) => (nextModels.includes(current) ? current : nextModels[0]));
      } catch {
        setModels(['llama3.1:8b']);
      }
    })();

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setSavedPrompts(JSON.parse(raw) as SavedPrompt[]);
      }
    } catch {
      setSavedPrompts([]);
    }
  }, []);

  function persistPrompts(next: SavedPrompt[]) {
    setSavedPrompts(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota/private mode issues and keep the in-memory state.
    }
  }

  function savePrompt() {
    const text = prompt.trim();
    if (!text) {
      return;
    }
    const suggestedName = `Prompt ${new Date().toLocaleString('it-IT')}`;
    const name = window.prompt('Nome del prompt', suggestedName);
    if (name === null) {
      return;
    }
    const next: SavedPrompt[] = [{ id: `${Date.now()}`, name: name.trim() || suggestedName, text }, ...savedPrompts];
    persistPrompts(next);
  }

  function applyPrompt(promptId: string) {
    const selected = savedPrompts.find((item) => item.id === promptId);
    if (selected) {
      setPrompt(selected.text);
    }
  }

  function editPrompt(promptId: string) {
    const selected = savedPrompts.find((item) => item.id === promptId);
    if (!selected) {
      return;
    }
    const name = window.prompt('Nome del prompt', selected.name);
    if (name === null) {
      return;
    }
    const text = window.prompt('Testo del prompt', selected.text);
    if (text === null) {
      return;
    }
    persistPrompts(
      savedPrompts.map((item) => (item.id === promptId ? { ...item, name: name.trim() || item.name, text: text.trim() || item.text } : item)),
    );
    if (prompt === selected.text) {
      setPrompt(text.trim() || selected.text);
    }
  }

  function deletePrompt(promptId: string) {
    persistPrompts(savedPrompts.filter((item) => item.id !== promptId));
  }

  async function runAnalysis() {
    setBusy(true);
    setOutput('');
    try {
      const startIso = toIso(timeScope.startTime);
      const endIso = toIso(timeScope.endTime);
      await streamAiAnalysis(
        {
          model,
          prompt,
          minutes: startIso && endIso ? undefined : 60,
          start_time: startIso,
          end_time: endIso,
        },
        (chunk) => {
          setOutput((current) => current + chunk);
        },
      );
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Errore analisi AI');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-section grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
      <section className="panel-card ai-panel panel-scroll">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Analisi AI</h2>
            <p className="panel__subtitle">Streaming Ollama con prompt operativi e finestra timeline condivisa.</p>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Model</label>
            <select className="select" title="Model" value={model} onChange={(event) => setModel(event.target.value)}>
              {models.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Scope timeline</label>
            <div className="detail-card">
              <strong>{timeScope.isCustom ? 'Finestra selezionata' : 'Ultimi 60 minuti / reset'}</strong>
              <div className="muted">{timeScope.label}</div>
            </div>
          </div>
          <div className="field field--full">
            <label>Prompt</label>
            <textarea className="textarea textarea--xl" title="Prompt AI" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </div>
        </div>

        <div className="actions actions--spaced">
          <button className="btn-secondary" type="button" onClick={savePrompt}>
            Salva prompt
          </button>
          <button className="btn-primary" type="button" onClick={() => void runAnalysis()} disabled={busy}>
            {busy ? 'Streaming…' : 'Esegui analisi'}
          </button>
        </div>

        <div className="panel__header panel__header--spaced">
          <div>
            <h2 className="panel__title">Prompt salvati</h2>
            <p className="panel__subtitle">Prompt personalizzati salvati nel browser.</p>
          </div>
        </div>

        {savedPrompts.length ? (
          <div className="list">
            {savedPrompts.map((item) => (
              <div key={item.id} className="list-item list-item--stacked">
                <div className="row-stack">
                  <strong>{item.name}</strong>
                  <span className="muted">{item.text.slice(0, 160)}{item.text.length > 160 ? '…' : ''}</span>
                </div>
                <div className="actions">
                  <button className="btn-secondary" type="button" onClick={() => applyPrompt(item.id)}>
                    Applica
                  </button>
                  <button className="btn-secondary" type="button" onClick={() => editPrompt(item.id)}>
                    Modifica
                  </button>
                  <button className="button button--danger" type="button" onClick={() => deletePrompt(item.id)}>
                    Elimina
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">Nessun prompt salvato.</div>
        )}
      </section>

      <section className="panel-card panel-scroll">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Output analisi</h2>
            <p className="panel__subtitle">Lo stream del modello resta visibile qui durante l'elaborazione.</p>
          </div>
        </div>

        <pre className="app-pre ai-output stack-gap-top">{output || 'L’output dell’analisi AI comparirà qui in streaming.'}</pre>
      </section>
    </div>
  );
}

