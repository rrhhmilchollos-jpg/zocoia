// src/components/AgentConfigPanel.tsx
// Edita un agente existente vía PUT /api/resources/:id. IMPORTANTE: ese
// endpoint reemplaza `data` ENTERO si lo mandas (no hace merge), así que este
// componente siempre reconstruye el objeto `data` completo antes de guardar,
// preservando campos que no edita el UI (habilidades, tipo, etc.) tal como
// vinieron cargados.

import { useState } from 'react';

const ALL_TOOL_NAMES = ['createFile', 'createFolder', 'readFile', 'executeCode', 'busqueda_web'];

interface AgentResource {
  id: string;
  name: string;
  data: {
    tipo?: string;
    systemPrompt?: string;
    temperature?: number;
    num_predict?: number;
    num_ctx?: number;
    allowedTools?: string[];
    habilidades?: string[];
    busquedaWeb?: boolean;
    [k: string]: any;
  };
}

interface AgentConfigPanelProps {
  agent: AgentResource;
  apiBase: string;
  authHeaders: () => Record<string, string>;
  isOwner: boolean;
  onSaved: (updated: AgentResource) => void;
}

function Slider({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs text-neutral-400">
        <span>{label}</span><span>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full accent-orange-600" />
    </div>
  );
}

export default function AgentConfigPanel({ agent, apiBase, authHeaders, isOwner, onSaved }: AgentConfigPanelProps) {
  const d = agent.data || {};
  const [systemPrompt, setSystemPrompt] = useState(d.systemPrompt || '');
  const [temperature, setTemperature] = useState(d.temperature ?? 0.7);
  const [numPredict, setNumPredict] = useState(d.num_predict ?? 4096);
  const [numCtx, setNumCtx] = useState(d.num_ctx ?? 8192);
  const [allowedTools, setAllowedTools] = useState<string[]>(d.allowedTools || []);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggleTool = (tool: string) => {
    if (!isOwner) return;
    setAllowedTools(prev => prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool]);
  };

  const save = async () => {
    setStatus('saving');
    setErrorMsg(null);
    try {
      const r = await fetch(`${apiBase}/api/resources/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: agent.name,
          // Objeto COMPLETO: preservamos lo que ya traía el agente y solo
          // pisamos los campos que este panel realmente edita.
          data: {
            ...d,
            systemPrompt,
            temperature,
            num_predict: numPredict,
            num_ctx: numCtx,
            allowedTools: isOwner ? allowedTools : (d.allowedTools || []),
            busquedaWeb: allowedTools.includes('busqueda_web'),
          },
        }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error || `Error ${r.status} al guardar`);
      setStatus('saved');
      onSaved(body);
      setTimeout(() => setStatus('idle'), 1500);
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.message || 'No se pudo guardar la configuración');
    }
  };

  return (
    <div className="space-y-6 text-neutral-100">
      <section>
        <h3 className="text-sm font-semibold mb-2">System Prompt</h3>
        <textarea
          value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6} placeholder="Eres un asistente experto en…"
          className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm font-mono
                     focus:outline-none focus:ring-2 focus:ring-orange-600"
        />
      </section>

      <section className="grid grid-cols-2 gap-4">
        <Slider label="Temperature" value={temperature} onChange={setTemperature} min={0} max={1.2} step={0.05} />
        <div>
          <label className="text-xs text-neutral-400">num_predict (tokens salida)</label>
          <input type="number" value={numPredict} min={256} max={8192}
            onChange={(e) => setNumPredict(parseInt(e.target.value || '0', 10))}
            className="mt-1 w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-neutral-400">num_ctx (contexto)</label>
          <input type="number" value={numCtx} min={2048} max={16384}
            onChange={(e) => setNumCtx(parseInt(e.target.value || '0', 10))}
            className="mt-1 w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm" />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Herramientas del sistema</h3>
        {!isOwner && (
          <p className="text-xs text-amber-400 mb-2">
            Tu plan actual no permite modificar las herramientas de este agente (gate Enterprise del servidor).
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {ALL_TOOL_NAMES.map(tool => {
            const active = allowedTools.includes(tool);
            return (
              <button key={tool} disabled={!isOwner} onClick={() => toggleTool(tool)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  active ? 'bg-orange-600/20 border-orange-500 text-orange-300'
                         : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                } ${!isOwner ? 'opacity-40 cursor-not-allowed' : 'hover:border-neutral-500'}`}
              >
                {tool}
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex items-center gap-3 pt-2 border-t border-neutral-800">
        <button onClick={save} disabled={status === 'saving'}
          className="px-4 py-2 text-sm rounded-md bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white">
          {status === 'saving' ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {status === 'saved' && <span className="text-xs text-green-400">Guardado ✓ (se aplica en el próximo mensaje del chat)</span>}
        {status === 'error' && <span className="text-xs text-red-400">{errorMsg}</span>}
      </div>
    </div>
  );
}
