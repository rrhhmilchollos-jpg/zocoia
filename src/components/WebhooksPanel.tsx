import React, { useState, useEffect, useCallback } from 'react';

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  lastTriggeredAt?: number;
  lastStatus?: number;
  createdAt: number;
}

const AVAILABLE_EVENTS = [
  { id: 'chat.completed', label: 'Chat completado', desc: 'Cada vez que se completa una respuesta de chat' },
  { id: 'session.created', label: 'Sesión creada', desc: 'Cuando se crea una nueva sesión de conversación' },
  { id: 'batch.completed', label: 'Lote completado', desc: 'Cuando un lote de peticiones termina de procesarse' },
  { id: 'credits.low', label: 'Créditos bajos', desc: 'Cuando el saldo cae por debajo del umbral' },
  { id: 'agent.created', label: 'Agente creado', desc: 'Cuando se crea un nuevo agente' },
  { id: 'webhook.test', label: 'Prueba', desc: 'Evento de prueba manual' },
];

function fmtDate(ts?: number) {
  if (!ts) return 'Nunca';
  return new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function WebhooksPanel({ authHeaders, API_BASE }: { authHeaders: () => Record<string, string>; API_BASE: string }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  // Formulario
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [formSecret, setFormSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const loadWebhooks = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/webhooks`, { headers: authHeaders() });
      if (r.ok) setWebhooks(await r.json());
    } finally { setLoading(false); }
  }, [authHeaders, API_BASE]);

  useEffect(() => { loadWebhooks(); }, [loadWebhooks]);

  const resetForm = () => { setFormName(''); setFormUrl(''); setFormEvents([]); setFormSecret(''); setEditingId(null); };

  const startEdit = (w: Webhook) => {
    setFormName(w.name); setFormUrl(w.url); setFormEvents(w.events); setFormSecret('');
    setEditingId(w.id); setShowCreate(true);
  };

  const saveWebhook = async () => {
    if (!formName.trim() || !formUrl.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`${API_BASE}/api/webhooks/${editingId}`, {
          method: 'PUT', headers: authHeaders(),
          body: JSON.stringify({ name: formName, url: formUrl, events: formEvents, secret: formSecret || undefined }),
        });
      } else {
        await fetch(`${API_BASE}/api/webhooks`, {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ name: formName, url: formUrl, events: formEvents, secret: formSecret || undefined }),
        });
      }
      resetForm(); setShowCreate(false); await loadWebhooks();
    } finally { setSaving(false); }
  };

  const toggleActive = async (w: Webhook) => {
    await fetch(`${API_BASE}/api/webhooks/${w.id}`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify({ active: !w.active }),
    });
    await loadWebhooks();
  };

  const deleteWebhook = async (id: string) => {
    if (!confirm('¿Eliminar este webhook?')) return;
    await fetch(`${API_BASE}/api/webhooks/${id}`, { method: 'DELETE', headers: authHeaders() });
    await loadWebhooks();
  };

  const testWebhook = async (id: string) => {
    setTesting(id);
    try {
      const r = await fetch(`${API_BASE}/api/webhooks/${id}/test`, { method: 'POST', headers: authHeaders() });
      const d = await r.json();
      setTestResult(p => ({ ...p, [id]: { ok: r.ok && d.ok, message: d.message || d.error || 'Sin respuesta' } }));
      await loadWebhooks();
    } finally { setTesting(null); }
  };

  const toggleEvent = (ev: string) => {
    setFormEvents(p => p.includes(ev) ? p.filter(e => e !== ev) : [...p, ev]);
  };

  return (
    <div className="max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Webhooks</h1>
          <p className="text-gray-500 text-xs mt-1">Recibe notificaciones HTTP en tiempo real cuando ocurren eventos en Zoco IA</p>
        </div>
        <button onClick={() => { resetForm(); setShowCreate(v => !v); }} className="bg-white text-black px-4 py-2 rounded-lg text-xs font-medium hover:bg-gray-200">
          {showCreate && !editingId ? '✕ Cancelar' : '+ Nuevo webhook'}
        </button>
      </div>

      {showCreate && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 mb-6">
          <h2 className="text-sm font-bold text-white mb-4">{editingId ? 'Editar webhook' : 'Nuevo webhook'}</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 mb-1 block">Nombre</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:border-green-500 outline-none" placeholder="Ej: Notificaciones Slack" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 mb-1 block">URL del endpoint</label>
              <input value={formUrl} onChange={e => setFormUrl(e.target.value)} className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:border-green-500 outline-none" placeholder="https://tu-servidor.com/webhook" />
            </div>
          </div>
          <div className="mb-4">
            <label className="text-[10px] font-bold uppercase text-gray-500 mb-2 block">Secreto HMAC (opcional)</label>
            <input value={formSecret} onChange={e => setFormSecret(e.target.value)} type="password" className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:border-green-500 outline-none" placeholder="Clave secreta para verificar la firma X-Zoco-Signature" />
          </div>
          <div className="mb-4">
            <label className="text-[10px] font-bold uppercase text-gray-500 mb-2 block">Eventos a escuchar</label>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_EVENTS.map(ev => (
                <div key={ev.id} onClick={() => toggleEvent(ev.id)} className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${formEvents.includes(ev.id) ? 'bg-green-900/20 border-green-700/40' : 'bg-[#111] border-[#333] hover:border-[#444]'}`}>
                  <div className={`w-3.5 h-3.5 rounded border mt-0.5 shrink-0 flex items-center justify-center ${formEvents.includes(ev.id) ? 'bg-green-500 border-green-500' : 'border-gray-600'}`}>
                    {formEvents.includes(ev.id) && <span className="text-[9px] text-white font-bold">✓</span>}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white">{ev.label}</p>
                    <p className="text-[10px] text-gray-600">{ev.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { resetForm(); setShowCreate(false); }} className="px-4 py-2 rounded-lg border border-[#333] text-xs text-gray-500 hover:bg-[#222]">Cancelar</button>
            <button onClick={saveWebhook} disabled={saving || !formName.trim() || !formUrl.trim()} className="bg-green-600 text-white px-5 py-2 rounded-lg text-xs font-bold hover:bg-green-700 disabled:opacity-50">
              {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Crear webhook'}
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-gray-600 text-xs text-center py-8">Cargando...</p>}
      {!loading && webhooks.length === 0 && (
        <div className="bg-[#1a1a1a] border border-dashed border-[#333] rounded-xl p-16 text-center">
          <div className="text-5xl mb-4">🔗</div>
          <p className="text-gray-500 text-sm">No tienes webhooks configurados todavía.</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 text-green-400 text-xs hover:underline">Crear el primero →</button>
        </div>
      )}

      <div className="space-y-3">
        {webhooks.map(w => (
          <div key={w.id} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${w.active ? 'bg-green-500' : 'bg-gray-600'}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-white">{w.name}</p>
                    {!w.active && <span className="text-[9px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">Inactivo</span>}
                  </div>
                  <p className="text-xs text-gray-500 font-mono truncate mt-0.5">{w.url}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(w.events || []).map(ev => (
                      <span key={ev} className="text-[9px] bg-green-900/20 text-green-400 border border-green-800/30 px-1.5 py-0.5 rounded">{ev}</span>
                    ))}
                    {(w.events || []).length === 0 && <span className="text-[9px] text-gray-700">Sin eventos configurados</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-gray-700">Último disparo: {fmtDate(w.lastTriggeredAt)}</span>
                    {w.lastStatus !== undefined && w.lastStatus !== null && (
                      <span className={`text-[10px] ${w.lastStatus >= 200 && w.lastStatus < 300 ? 'text-green-500' : 'text-red-400'}`}>
                        HTTP {w.lastStatus}
                      </span>
                    )}
                  </div>
                  {testResult[w.id] && (
                    <p className={`text-[10px] mt-1 ${testResult[w.id].ok ? 'text-green-400' : 'text-red-400'}`}>
                      {testResult[w.id].ok ? '✓' : '✗'} {testResult[w.id].message}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => testWebhook(w.id)} disabled={testing === w.id} className="text-[10px] bg-[#222] text-gray-400 border border-[#333] px-2.5 py-1.5 rounded-lg hover:bg-[#2a2a2a] disabled:opacity-50">
                  {testing === w.id ? '...' : '▶ Probar'}
                </button>
                <button onClick={() => toggleActive(w)} className={`text-[10px] px-2.5 py-1.5 rounded-lg border ${w.active ? 'bg-amber-900/20 text-amber-400 border-amber-700/30 hover:bg-amber-900/30' : 'bg-green-900/20 text-green-400 border-green-700/30 hover:bg-green-900/30'}`}>
                  {w.active ? 'Pausar' : 'Activar'}
                </button>
                <button onClick={() => startEdit(w)} className="text-[10px] bg-[#222] text-gray-400 border border-[#333] px-2.5 py-1.5 rounded-lg hover:bg-[#2a2a2a]">✏️</button>
                <button onClick={() => deleteWebhook(w.id)} className="text-[10px] bg-red-900/20 text-red-400 border border-red-800/30 px-2.5 py-1.5 rounded-lg hover:bg-red-900/30">🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
