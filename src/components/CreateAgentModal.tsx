// src/components/CreateAgentModal.tsx
// Crea un agente real vía POST /api/resources { type: 'agente', name, data }.
// Respeta el contrato exacto de server.js: si el usuario no es owner y activa
// tools del sistema, el servidor responde 403 con ENTERPRISE_REQUIRED_MESSAGE —
// este componente muestra ese mensaje tal cual lo manda la API, sin inventarse
// uno propio, y deshabilita las tools en el UI si ya sabemos que no es owner.

import { useState } from 'react';

const ALL_TOOL_NAMES = ['createFile', 'createFolder', 'readFile', 'executeCode', 'busqueda_web'];
// ⚠️ Debe coincidir con ALL_TOOL_NAMES exportado por tools.js. Si añades una
// tool nueva ahí, añádela aquí también (no hay endpoint que las liste hoy).

interface CreateAgentModalProps {
  open: boolean;
  apiBase: string;
  authHeaders: () => Record<string, string>;
  isOwner: boolean; // pásalo desde el estado de sesión que ya tengas en Dashboard.tsx
  onClose: () => void;
  onCreated: (agent: { id: string; type: string; name: string; data: any }) => void;
}

export default function CreateAgentModal({
  open, apiBase, authHeaders, isOwner, onClose, onCreated,
}: CreateAgentModalProps) {
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName(''); setSystemPrompt(''); setTemperature(0.7); setAllowedTools([]); setError(null);
  };

  const toggleTool = (tool: string) => {
    if (!isOwner) return; // el servidor lo rechazaría igualmente; ni lo intentamos
    setAllowedTools(prev => prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool]);
  };

  const submit = async () => {
    if (name.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/api/resources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          type: 'agente',
          name: name.trim(),
          data: {
            tipo: 'prompted',
            systemPrompt,
            temperature,
            num_predict: 4096,
            num_ctx: 8192,
            allowedTools: isOwner ? allowedTools : [], // nunca mandamos tools si no es owner
            habilidades: [],
            busquedaWeb: allowedTools.includes('busqueda_web'),
          },
        }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        // Mensaje real del servidor (incluye el caso 403 enterprise_required)
        throw new Error(body?.error || `Error ${r.status} al crear el agente`);
      }
      reset();
      onCreated(body);
      onClose();
    } catch (e: any) {
      setError(e.message || 'No se pudo crear el agente. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl
                      transition-all duration-150 ease-out max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-neutral-800 flex justify-between items-center">
          <h2 className="text-sm font-semibold text-neutral-100">Crear nuevo agente</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-100">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs text-neutral-400">Nombre del agente</label>
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="ej. Asistente de Soporte"
              className="mt-1 w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm
                         text-neutral-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-400">System Prompt</label>
            <textarea
              value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5} placeholder="Eres un asistente experto en…"
              className="mt-1 w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm font-mono
                         text-neutral-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs text-neutral-400">
              <span>Temperature</span><span>{temperature}</span>
            </div>
            <input
              type="range" min={0} max={1.2} step={0.05} value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-orange-600"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-400">Herramientas del sistema</label>
            {!isOwner && (
              <p className="text-xs text-amber-400 mt-1">
                Tu plan actual (Agentes Básicos) no permite asignar herramientas del sistema
                a agentes personalizados. Esto lo aplica el servidor, no solo el UI.
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-1">
              {ALL_TOOL_NAMES.map(tool => {
                const active = allowedTools.includes(tool);
                return (
                  <button
                    key={tool}
                    disabled={!isOwner}
                    onClick={() => toggleTool(tool)}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                      active
                        ? 'bg-orange-600/20 border-orange-500 text-orange-300'
                        : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                    } ${!isOwner ? 'opacity-40 cursor-not-allowed' : 'hover:border-neutral-500'}`}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-neutral-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-neutral-300 hover:bg-neutral-800">
            Cancelar
          </button>
          <button
            disabled={loading || name.trim().length < 2}
            onClick={submit}
            className="px-3 py-1.5 text-sm rounded-md bg-orange-600 hover:bg-orange-500
                       disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            {loading ? 'Creando…' : 'Crear agente'}
          </button>
        </div>
      </div>
    </div>
  );
}
