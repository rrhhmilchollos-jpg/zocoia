import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';
import { ToastProvider, toast, CopyButton, Button, Badge, Spinner } from '../components/ui';
import AgentModal from '../components/AgentModal';
import ApiKeyModal from '../components/ApiKeyModal';
import OrdenadorZoco from './OrdenadorZoco';
import SkillsPanel from '../components/SkillsPanel';
import { useApi } from '../hooks/useApi';

/* ── tipos ── */
interface Recurso { id: string; type: string; name: string; data: Record<string, any>; createdAt: string; updatedAt?: string; }
interface ApiKey { id: string; name: string; display: string; revoked: boolean; createdAt: string; type: string; monthlyTokensUsed?: number; monthlyTokenLimit?: number | null; }
interface AdminUsuario { id: string; email: string; nombre: string; isAdmin: boolean; isSupport: boolean; creditos: number; activo: boolean; createdAt: string; }
interface BillingSummary { creditos: number; gastoEsteMes: number; recursos: Record<string, number>; clavesActivas: number; }
interface MemoriaMensaje { id: string; role: string; content: string; created_at: string; }
interface Payment { id: string; amount: number; credits: number; status: string; created_at: string; }
interface CreditPack { id: string; euros: number; credits: number; label: string; }
interface ChatMsg { role: string; content: string; }

function fmtEUR(n: number) { return `${(n || 0).toFixed(2)} €`; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('es-ES'); }

const MODELOS = [
  { nombre: 'Zoco-Flash', backend: 'zoco-flash', badge: null, ollamaModel: 'OLLAMA_MODEL_FLASH', tags: ['Más rápido', 'Menor coste', 'Alto volumen'], color: 'from-teal-400 to-emerald-500', icon: '⚡' },
  { nombre: 'Zoco-Plus', backend: 'zoco-plus', badge: null, ollamaModel: 'OLLAMA_MODEL_PLUS', tags: ['Tareas cotidianas', 'Escritura', 'Rentable'], color: 'from-slate-500 to-slate-700', icon: '✳' },
  { nombre: 'Zoco-Max', backend: 'zoco-max', badge: null, ollamaModel: 'OLLAMA_MODEL_MAX', tags: ['Proyectos complejos', 'Agentes', 'Programación'], color: 'from-orange-400 to-rose-500', icon: '◈' },
  { nombre: 'Zoco-Lab', backend: 'zoco-lab', badge: 'Beta', ollamaModel: 'OLLAMA_MODEL_LAB', tags: ['Experimental', 'Investigación', 'Nuevas capacidades'], color: 'from-purple-500 to-indigo-600', icon: '✦' },
];

const RESOURCE_SECTIONS = [
  { key: 'archivo', label: 'Archivos', icon: '📁' },
  { key: 'habilidad', label: 'Habilidades', icon: '⚡' },
  { key: 'lote', label: 'Lotes', icon: '📦' },
  { key: 'sesion', label: 'Sesiones', icon: '💬' },
  { key: 'implementacion', label: 'Implementaciones', icon: '🚀' },
  { key: 'entorno', label: 'Entornos', icon: '🌐' },
  { key: 'credencial', label: 'Almacén de credenciales', icon: '🔒' },
  { key: 'memoria', label: 'Almacenes de memoria', icon: '🧠' },
];

export default function Dashboard() {
  const { user, token, logout } = useAuth();
  const { get, post, put, del } = useApi();

  const [activeTab, setActiveTab] = useState('panel');
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [agentes, setAgentes] = useState<Recurso[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [resourcesByType, setResourcesByType] = useState<Record<string, Recurso[]>>({});
  const [adminUsuarios, setAdminUsuarios] = useState<AdminUsuario[]>([]);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [adminLogs, setAdminLogs] = useState<any[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [creditPacks, setCreditPacks] = useState<CreditPack[]>([]);
  const [selectedModel, setSelectedModel] = useState('zoco-plus');
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [agentMemory, setAgentMemory] = useState<Record<string, { mensajes: MemoriaMensaje[]; cacheActiva: boolean }>>({});
  const [adminTab, setAdminTab] = useState<'usuarios' | 'pagos' | 'sistema' | 'logs'>('usuarios');
  const [payingPack, setPayingPack] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [buildExpanded, setBuildExpanded] = useState(true);
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [analyticsExpanded, setAnalyticsExpanded] = useState(false);
  const [notification, setNotification] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState<Recurso | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Modales
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Recurso | null>(null);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [skillsPanelOpen, setSkillsPanelOpen] = useState(false);

  // Indicador de red
  const [networkError, setNetworkError] = useState(false);

  const authHeaders = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const load = useCallback(async (url: string, setter: (d: any) => void) => {
    try {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (r.ok) { setter(await r.json()); setNetworkError(false); }
    } catch { setNetworkError(true); }
  }, [authHeaders]);

  const loadAgents = useCallback(() => load('/api/resources?type=agente', setAgentes), [load]);

  useEffect(() => {
    if (user?.modeloActivo) setSelectedModel(user.modeloActivo);
    load('/api/billing/summary', setBilling);
    loadAgents();
    load('/api/payments/packs', setCreditPacks);
  }, [load, loadAgents, user?.modeloActivo]);

  useEffect(() => {
    if (activeTab === 'keys') load('/api/keys', setKeys);
    if (activeTab === 'billing') { load('/api/payments/history', setPayments); load('/api/billing/summary', setBilling); }
    if (activeTab === 'admin') { load('/admin/clientes', setAdminUsuarios); load('/admin/stats', setAdminStats); }
    if (activeTab !== 'chat') setActiveAgent(null);
    const rs = RESOURCE_SECTIONS.find(s => s.key === activeTab);
    if (rs) load(`/api/resources?type=${rs.key}`, d => setResourcesByType(p => ({ ...p, [rs.key]: d })));
  }, [activeTab, load]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const handleOpenNewAgent = () => { setEditingAgent(null); setAgentModalOpen(true); };
  const handleOpenEditAgent = (a: Recurso) => { setEditingAgent(a); setAgentModalOpen(true); };

  const handleDeleteResource = async (id: string, type: string) => {
    if (!confirm('¿Eliminar?')) return;
    try {
      await del(`/api/resources/${id}`);
      if (type === 'agente') {
        setAgentes(p => p.filter(a => a.id !== id));
        if (activeAgent?.id === id) { setActiveAgent(null); setChatMessages([]); }
      } else {
        setResourcesByType(p => ({ ...p, [type]: (p[type] || []).filter(x => x.id !== id) }));
      }
      load('/api/billing/summary', setBilling);
      toast('success', 'Eliminado correctamente');
    } catch (e: any) { toast('error', e.message); }
  };

  const handleCreateResource = async (type: string) => {
    const name = prompt('Nombre:'); if (!name) return;
    try {
      const data = await post<Recurso>('/api/resources', { type, name });
      setResourcesByType(p => ({ ...p, [type]: [...(p[type] || []), data] }));
    } catch (e: any) { toast('error', e.message); }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('¿Revocar esta clave?')) return;
    try {
      await del(`/api/keys/${id}`);
      setKeys(p => p.filter(k => k.id !== id));
      toast('success', 'Clave revocada');
    } catch (e: any) { toast('error', e.message); }
  };

  const handleSelectModel = async (modelo: string) => {
    setSelectedModel(modelo);
    try {
      await put('/api/user/modelo', { modelo });
    } catch {}
  };

  const handleBuyPack = async (packId: string) => {
    setPayingPack(packId);
    try {
      const d = await post<any>('/api/payments/create', { packId });
      if (d.checkoutUrl) window.open(d.checkoutUrl, '_blank');
    } catch (e: any) { toast('error', e.message || 'Error al crear el pago'); }
    finally { setPayingPack(null); }
  };

  const handleToggleMemoria = async (agentId: string) => {
    if (expandedAgentId === agentId) { setExpandedAgentId(null); return; }
    setExpandedAgentId(agentId);
    load(`/api/agentes/${agentId}/memoria`, d => setAgentMemory(p => ({ ...p, [agentId]: d })));
  };

  const handleClearMemoria = async (agentId: string) => {
    if (!confirm('¿Borrar toda la memoria?')) return;
    try {
      await del(`/api/agentes/${agentId}/memoria`);
      setAgentMemory(p => ({ ...p, [agentId]: { mensajes: [], cacheActiva: false } }));
      toast('success', 'Memoria borrada');
    } catch (e: any) { toast('error', e.message); }
  };

  const handleAdminTopup = async (userId: string, email: string) => {
    const amt = prompt(`Créditos a añadir a ${email}:`, '10'); if (!amt) return;
    try {
      await put(`/admin/clientes/${userId}`, { creditos: Number(amt), _addCredits: true });
      load('/admin/clientes', setAdminUsuarios);
      toast('success', `+${amt} créditos añadidos`);
    } catch (e: any) { toast('error', e.message); }
  };

  const handleToggleUser = async (u: AdminUsuario) => {
    try {
      await put(`/admin/clientes/${u.id}`, { activo: !u.activo });
      load('/admin/clientes', setAdminUsuarios);
    } catch (e: any) { toast('error', e.message); }
  };

  const handleOpenAgentChat = (agente: Recurso) => {
    setActiveAgent(agente);
    setChatMessages([]);
    setActiveTab('chat');
  };

  const sendChat = async () => {
    const msg = chatInput.trim(); if (!msg || chatLoading) return;
    setChatInput('');
    const newMessages: ChatMsg[] = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(newMessages);
    setChatLoading(true);
    try {
      const r = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ messages: newMessages, model: selectedModel, agentId: activeAgent?.id }),
      });
      const d = await r.json();
      if (r.ok) setChatMessages(prev => [...prev, { role: 'assistant', content: d.choices?.[0]?.message?.content || '' }]);
      else setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${d.error || 'Sin respuesta'}` }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error de conexión. Reintentando en la próxima solicitud.' }]);
    } finally { setChatLoading(false); }
  };

  const balance = billing?.creditos ?? 0;
  const spend = billing?.gastoEsteMes ?? 0;
  const balanceLow = balance < 1;

  const NavItem = ({ tab, label, icon }: { tab: string; label: string; icon: string }) => (
    <button onClick={() => setActiveTab(tab)}
      className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-left text-[13px] transition-colors ${activeTab === tab ? 'bg-[#2a2a2a] text-white font-medium' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1e1e1e]'}`}>
      <span className="text-base">{icon}</span><span>{label}</span>
    </button>
  );

  return (
    <>
      <ToastProvider />

      {/* Modales */}
      <AgentModal
        open={agentModalOpen}
        onClose={() => setAgentModalOpen(false)}
        agente={editingAgent}
        onSaved={loadAgents}
      />
      <ApiKeyModal
        open={keyModalOpen}
        onClose={() => setKeyModalOpen(false)}
        onCreated={() => load('/api/keys', setKeys)}
      />
      <SkillsPanel open={skillsPanelOpen} onClose={() => setSkillsPanelOpen(false)} />

      <div className="flex h-screen bg-[#111111] text-gray-200 font-sans overflow-hidden text-sm">

        {/* SIDEBAR */}
        <aside className={`${sidebarOpen ? 'w-60' : 'w-14'} bg-[#151515] border-r border-[#222] flex flex-col transition-all duration-200 shrink-0 h-full overflow-y-auto`}>
          <div className="p-3 flex items-center justify-between border-b border-[#222]">
            {sidebarOpen && (
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-blue-600 rounded flex items-center justify-center text-white text-xs font-bold">Z</div>
                <span className="font-semibold text-white text-sm">Zoco IA Console</span>
              </div>
            )}
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-500 hover:text-gray-300 p-1">
              {sidebarOpen ? '◀' : '▶'}
            </button>
          </div>

          {sidebarOpen && (
            <nav className="flex-1 p-2 space-y-0.5">
              <NavItem tab="panel" label="Panel de control" icon="🏠" />
              <NavItem tab="keys" label="Claves de API" icon="🔑" />
              <NavItem tab="chat" label="Chat IA" icon="💬" />
              <NavItem tab="billing" label="Facturación" icon="💳" />

              <div className="pt-3">
                <button onClick={() => setBuildExpanded(!buildExpanded)} className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-gray-300">
                  <span>Compilar</span><span>{buildExpanded ? '▾' : '▸'}</span>
                </button>
                {buildExpanded && (
                  <div className="mt-0.5 space-y-0.5">
                    <NavItem tab="archivo" label="Archivos" icon="📁" />
                    <button onClick={() => setSkillsPanelOpen(true)} className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-left text-[13px] transition-colors text-gray-400 hover:text-gray-200 hover:bg-[#1e1e1e]">
                      <span className="text-base">⚡</span><span>Habilidades</span>
                    </button>
                    <NavItem tab="lote" label="Lotes" icon="📦" />
                  </div>
                )}
              </div>

              <div className="pt-2">
                <button onClick={() => setAgentsExpanded(!agentsExpanded)} className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-gray-300">
                  <span>Agentes gestionados</span><span>{agentsExpanded ? '▾' : '▸'}</span>
                </button>
                {agentsExpanded && (
                  <div className="mt-0.5 space-y-0.5">
                    <NavItem tab="agentes" label="Inicio rápido" icon="🚀" />
                    <NavItem tab="mis-agentes" label="Agentes" icon="🤖" />
                    <NavItem tab="sesion" label="Sesiones" icon="💬" />
                    <NavItem tab="implementacion" label="Implementaciones" icon="⚙️" />
                    <NavItem tab="entorno" label="Entornos" icon="🌐" />
                    <NavItem tab="credencial" label="Almacén de cred." icon="🔒" />
                    <NavItem tab="memoria" label="Almacenes memoria" icon="🧠" />
                  </div>
                )}
              </div>

              <div className="pt-2">
                <button onClick={() => setAnalyticsExpanded(!analyticsExpanded)} className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-gray-300">
                  <span>Analíticas</span><span>{analyticsExpanded ? '▾' : '▸'}</span>
                </button>
                {analyticsExpanded && (
                  <div className="mt-0.5 space-y-0.5">
                    <NavItem tab="uso" label="Uso general" icon="📊" />
                  </div>
                )}
              </div>

              {user?.isAdmin && (
                <div className="pt-2">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-red-500 uppercase tracking-wider">Administración</div>
                  <NavItem tab="admin" label="Panel Admin" icon="🛡️" />
                </div>
              )}
              <div className="pt-2">
              <div className="px-3 py-1.5 text-[11px] font-bold text-purple-500/70 uppercase tracking-wider">Ordenador</div>
              <NavItem tab="ordenador" label="Ordenador de Zoco" icon="🖥️" />
            </div>
            <div className="pt-2"><NavItem tab="docs" label="Documentación" icon="📖" /></div>
            </nav>
          )}

          {sidebarOpen && (
            <div className="border-t border-[#222] p-3 space-y-2">
              {balanceLow && (
                <div className="bg-amber-900/30 border border-amber-700/40 rounded-lg p-2.5 text-[11px] text-amber-300">
                  ⚠️ Saldo bajo. <button onClick={() => setActiveTab('billing')} className="underline">Añadir fondos</button>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 min-w-0">
                  <div className="w-7 h-7 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0">
                    {(user?.nombre || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-white leading-tight truncate text-xs">{user?.nombre || 'Usuario'}</p>
                    <p className="text-[10px] text-gray-500">{user?.isAdmin ? '👑 Admin' : 'Cliente'}</p>
                  </div>
                </div>
                <button onClick={logout} title="Cerrar sesión" className="text-gray-600 hover:text-red-400 text-xs ml-1">⏏</button>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className={`font-bold ${balanceLow ? 'text-amber-400' : 'text-green-400'}`}>{fmtEUR(balance)}</span>
                <button onClick={() => setActiveTab('billing')} className="text-purple-400 hover:text-purple-300">+ Añadir fondos</button>
              </div>
            </div>
          )}
        </aside>

        {/* MAIN */}
        <main className="flex-1 overflow-y-auto h-full bg-[#111111]">

          {/* Banners */}
          {networkError && (
            <div className="bg-red-950/60 border-b border-red-700/50 px-6 py-2 flex items-center gap-2 text-xs text-red-300">
              <span>⚠️</span> Sin conexión con el servidor. Reintentando automáticamente...
              <button onClick={() => { setNetworkError(false); load('/api/billing/summary', setBilling); }} className="ml-auto underline">Reintentar ahora</button>
            </div>
          )}
          {notification && (
            <div className="bg-[#1a1a2e] border-b border-[#333] px-6 py-2.5 flex items-center justify-between text-[12px]">
              <span className="text-blue-300">ℹ️ Zoco IA Console activo · Ollama local en línea · {agentes.length} agentes registrados</span>
              <button onClick={() => setNotification(false)} className="text-gray-600 hover:text-gray-400">✕</button>
            </div>
          )}

          <div className="p-8">

            {/* ── PANEL ── */}
            {activeTab === 'panel' && (
              <>
                <div className="flex items-center justify-between mb-8">
                  <h1 className="text-2xl font-bold text-white">Buenos días, {user?.nombre?.split(' ')[0] || 'Maria'}</h1>
                  <div className="flex items-center space-x-2">
                    <Button variant="secondary" size="sm" onClick={() => setActiveTab('docs')}>📖 Documentación</Button>
                    <Button variant="secondary" size="sm" onClick={() => setActiveTab('keys')}>🔑 Obtener clave</Button>
                    <Button size="sm" onClick={handleOpenNewAgent}>🤖 Crear agente</Button>
                  </div>
                </div>

                {balanceLow && (
                  <div className="mb-6 bg-amber-950/40 border border-amber-700/50 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-amber-400 text-lg">⚠️</span>
                      <div>
                        <p className="text-amber-300 font-medium text-sm">Saldo pendiente de {fmtEUR(Math.abs(balance))}</p>
                        <p className="text-amber-400/70 text-xs mt-0.5">Añade fondos para reanudar el acceso a la API.</p>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setActiveTab('billing')}>Añadir fondos</Button>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4 mb-8">
                  {[
                    { label: 'Créditos', value: fmtEUR(balance), sub: <button onClick={() => setActiveTab('billing')} className="text-purple-400 text-xs hover:underline mt-1 block">Añadir fondos →</button>, color: balanceLow ? 'text-amber-400' : 'text-white' },
                    { label: 'Gasto este mes', value: fmtEUR(spend), sub: <div className="w-full bg-[#2a2a2a] rounded-full h-1 mt-2"><div className="bg-purple-500 h-1 rounded-full" style={{ width: `${Math.min(100, (spend / 200) * 100)}%` }} /></div>, color: 'text-white' },
                    { label: 'Claves activas', value: billing?.clavesActivas ?? 0, sub: <span className="text-gray-600 text-xs">{Object.values(billing?.recursos || {}).reduce((a, b) => a + b, 0)} recursos totales</span>, color: 'text-white' },
                  ].map(s => (
                    <div key={s.label} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
                      <p className="text-gray-500 text-xs mb-2">{s.label}</p>
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                      <div>{s.sub}</div>
                    </div>
                  ))}
                </div>

                <h2 className="text-lg font-bold text-white mb-4">Modelos</h2>
                <div className="grid grid-cols-4 gap-4 mb-8">
                  {MODELOS.map(m => {
                    const active = selectedModel === m.backend;
                    return (
                      <div key={m.backend} onClick={() => { handleSelectModel(m.backend); setActiveAgent(null); setActiveTab('chat'); }}
                        className={`bg-[#1a1a1a] border rounded-xl overflow-hidden cursor-pointer transition-all hover:border-[#555] ${active ? 'border-purple-500 ring-1 ring-purple-500/30' : 'border-[#2a2a2a]'}`}>
                        <div className={`h-28 bg-gradient-to-br ${m.color} flex items-center justify-center relative`}>
                          <span className="text-white text-4xl opacity-80">{m.icon}</span>
                          {active && <span className="absolute top-2 right-2 bg-black/50 text-white text-[9px] px-1.5 py-0.5 rounded-full">✓ Activo</span>}
                        </div>
                        <div className="p-3">
                          <div className="flex items-center space-x-1.5 mb-1">
                            <p className="font-bold text-white text-sm">{m.nombre}</p>
                            {m.badge && <Badge variant="purple">{m.badge}</Badge>}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {m.tags.map(t => <span key={t} className="bg-[#252525] text-gray-400 text-[10px] px-1.5 py-0.5 rounded border border-[#333]">{t}</span>)}
                          </div>
                          <div className="mt-2 text-[10px] text-gray-600 font-mono">→ {m.ollamaModel}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <h2 className="text-lg font-bold text-white mb-4">Recursos</h2>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Herramienta de uso', desc: 'Aumenta la inteligencia minimizando el coste', badge: 'Beta', icon: '🔧' },
                    { label: 'Modo rápido', desc: 'Hasta 2.5x más rápido en los modelos compatibles', badge: null, icon: '⚡' },
                    { label: 'Batch API', desc: 'Mueve las cargas de trabajo asíncronas', badge: null, icon: '📦' },
                    { label: 'Caché de prompts', desc: 'Reutiliza prefijos de prompt para reducir costes', badge: null, icon: '🧮' },
                  ].map(r => (
                    <div key={r.label} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4 hover:border-[#444] cursor-pointer transition-colors">
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="text-lg">{r.icon}</span>
                        <span className="font-medium text-white text-xs">{r.label}</span>
                        {r.badge && <Badge variant="blue">{r.badge}</Badge>}
                      </div>
                      <p className="text-gray-500 text-[11px] leading-relaxed">{r.desc}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── CHAT ── */}
            {activeTab === 'chat' && (
              <div className="max-w-3xl mx-auto flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h1 className="text-xl font-bold text-white">{activeAgent ? `Chat con ${activeAgent.name}` : 'Chat con Zoco IA'}</h1>
                    {activeAgent && (
                      <button onClick={() => { setActiveAgent(null); setChatMessages([]); }} className="text-xs text-purple-400 hover:underline mt-0.5">← Chat general</button>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-500">Modelo:</span>
                    <select value={selectedModel} onChange={e => handleSelectModel(e.target.value)}
                      className="bg-[#1a1a1a] border border-[#333] text-gray-300 text-xs px-2 py-1 rounded-lg">
                      {MODELOS.map(m => <option key={m.backend} value={m.backend}>{m.nombre}</option>)}
                    </select>
                    <Button variant="ghost" size="sm" onClick={() => setChatMessages([])}>🗑</Button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4 mb-4 space-y-4">
                  {chatMessages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <div className="text-5xl mb-4">{activeAgent ? activeAgent.name.charAt(0) : 'Z'}</div>
                      <p className="text-gray-400 font-medium">{activeAgent ? `${activeAgent.name} listo` : 'Zoco IA listo'}</p>
                      <p className="text-xs mt-1 text-gray-600">Motor: Ollama · {MODELOS.find(m => m.backend === selectedModel)?.nombre}</p>
                    </div>
                  )}
                  {chatMessages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {m.role === 'assistant' && (
                        <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-0.5 shrink-0">
                          {activeAgent ? activeAgent.name.charAt(0).toUpperCase() : 'Z'}
                        </div>
                      )}
                      <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-purple-600 text-white rounded-br-sm' : 'bg-[#252525] text-gray-200 rounded-bl-sm border border-[#333]'}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-0.5 shrink-0">Z</div>
                      <div className="bg-[#252525] border border-[#333] px-4 py-2.5 rounded-2xl text-sm text-gray-500">
                        <span className="inline-flex space-x-1">
                          <span className="animate-bounce">●</span><span className="animate-bounce" style={{ animationDelay: '0.1s' }}>●</span><span className="animate-bounce" style={{ animationDelay: '0.2s' }}>●</span>
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <div className="flex space-x-2">
                  <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                    placeholder="Escribe un mensaje..." disabled={chatLoading}
                    className="flex-1 bg-[#1a1a1a] border border-[#333] text-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50 placeholder-gray-600" />
                  <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                    className="bg-purple-600 text-white px-5 py-3 rounded-xl font-medium text-sm hover:bg-purple-500 disabled:opacity-40">➤</button>
                </div>
              </div>
            )}

            {/* ── CLAVES API ── */}
            {activeTab === 'keys' && (
              <div className="max-w-4xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h1 className="text-2xl font-bold text-white">Claves de API</h1>
                    <p className="text-gray-500 text-xs mt-1">Claves secretas para autenticarte en la API de Zoco IA</p>
                  </div>
                  <Button onClick={() => setKeyModalOpen(true)}>+ Nueva clave</Button>
                </div>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
                  {keys.length === 0 ? (
                    <div className="p-10 text-center">
                      <div className="text-3xl mb-3">🔑</div>
                      <p className="text-gray-500 text-sm mb-4">Sin claves todavía</p>
                      <Button size="sm" onClick={() => setKeyModalOpen(true)}>Crear primera clave</Button>
                    </div>
                  ) : keys.map(k => (
                    <div key={k.id} className="flex items-center justify-between p-4 border-b border-[#222] last:border-0 hover:bg-[#1e1e1e]">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-[#252525] rounded-lg border border-[#333] flex items-center justify-center text-sm">🔑</div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-white text-sm">{k.name}</p>
                            <Badge variant={k.type === 'gratuita' ? 'amber' : 'purple'}>{k.type === 'gratuita' ? 'Gratuita' : 'Pago'}</Badge>
                          </div>
                          <p className="text-xs text-gray-600 mt-0.5">Creada el {fmtDate(k.createdAt)}{k.type === 'gratuita' && k.monthlyTokenLimit ? ` · ${(k.monthlyTokensUsed || 0).toLocaleString()} / ${k.monthlyTokenLimit.toLocaleString()} tokens este mes` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <code className="bg-[#252525] border border-[#333] px-3 py-1 rounded text-xs text-gray-400 font-mono">{k.display}</code>
                        <CopyButton text={k.display} label="Copiar prefijo" />
                        <Button variant="danger" size="sm" onClick={() => handleDeleteKey(k.id)}>Revocar</Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 bg-[#1a1a1a] border border-[#222] rounded-xl p-4 text-xs text-gray-500 space-y-1.5">
                  <p>🔐 Las claves se almacenan hasheadas con SHA-256. Solo son visibles completas en el momento de creación.</p>
                  <p>🌐 Endpoint de la API: <code className="text-gray-300">{API_BASE}/v1/chat/completions</code></p>
                  <p>📋 Cabecera: <code className="text-gray-300">Authorization: Bearer sk-zoco-...</code></p>
                </div>
              </div>
            )}

            {/* ── FACTURACIÓN ── */}
            {activeTab === 'billing' && (
              <div className="max-w-4xl">
                <h1 className="text-2xl font-bold text-white mb-2">Facturación y créditos</h1>
                <p className="text-gray-500 text-xs mb-6">Los créditos se añaden automáticamente al confirmar el pago.</p>
                <div className="grid grid-cols-3 gap-4 mb-8">
                  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
                    <p className="text-gray-500 text-xs mb-2">Saldo actual</p>
                    <p className={`text-3xl font-bold ${balanceLow ? 'text-amber-400' : 'text-green-400'}`}>{fmtEUR(balance)}</p>
                    <p className="text-gray-600 text-xs mt-2">Gasto mes: {fmtEUR(spend)}</p>
                  </div>
                  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 col-span-2">
                    <p className="text-gray-500 text-xs mb-3">Resumen</p>
                    {[['Claves activas', billing?.clavesActivas ?? 0], ['Recursos', Object.values(billing?.recursos || {}).reduce((a, b) => a + b, 0)], ['Pagos', payments.filter(p => p.status === 'completed').length]].map(([k, v]) => (
                      <div key={String(k)} className="flex justify-between border-b border-[#222] pb-2 mb-2 text-xs last:border-0 last:mb-0 last:pb-0">
                        <span className="text-gray-500">{k}</span><span className="font-bold text-white">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <h2 className="text-base font-bold text-white mb-4">Paquetes de créditos</h2>
                <div className="grid grid-cols-5 gap-3 mb-8">
                  {(creditPacks.length > 0 ? creditPacks : [
                    { id: 'starter', euros: 5, credits: 5, label: 'Starter' },
                    { id: 'basic', euros: 10, credits: 11, label: 'Basic' },
                    { id: 'pro', euros: 25, credits: 28, label: 'Pro' },
                    { id: 'business', euros: 50, credits: 60, label: 'Business' },
                    { id: 'enterprise', euros: 100, credits: 125, label: 'Enterprise' },
                  ]).map(pack => (
                    <div key={pack.id} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4 flex flex-col items-center text-center hover:border-purple-700/50 transition-colors">
                      <p className="font-bold text-white text-xs">{pack.label}</p>
                      <p className="text-2xl font-bold text-white mt-2">{pack.euros}€</p>
                      <p className="text-green-400 text-xs font-medium mt-1">{pack.credits} créditos</p>
                      {pack.credits > pack.euros && <p className="text-purple-400 text-[10px] mt-0.5">+{pack.credits - pack.euros} bonus</p>}
                      <Button onClick={() => handleBuyPack(pack.id)} loading={payingPack === pack.id} size="sm" className="mt-3 w-full">Comprar</Button>
                    </div>
                  ))}
                </div>
                <h2 className="text-base font-bold text-white mb-4">Historial</h2>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
                  {payments.length === 0 ? <div className="p-8 text-center text-gray-600 text-sm">Sin pagos todavía.</div> : (
                    <table className="w-full text-xs">
                      <thead className="bg-[#161616] border-b border-[#222] text-gray-500">
                        <tr>{['Fecha', 'Importe', 'Créditos', 'Estado'].map(h => <th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-[#1e1e1e]">
                        {payments.map(p => (
                          <tr key={p.id} className="hover:bg-[#1e1e1e]">
                            <td className="px-4 py-3 text-gray-500">{fmtDate(p.created_at)}</td>
                            <td className="px-4 py-3 font-medium text-white">{fmtEUR(p.amount)}</td>
                            <td className="px-4 py-3 text-green-400">+{p.credits}</td>
                            <td className="px-4 py-3"><Badge variant={p.status === 'completed' ? 'green' : 'amber'}>{p.status === 'completed' ? '✓ Completado' : '⏳ Pendiente'}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* ── AGENTES ── */}
            {(activeTab === 'agentes' || activeTab === 'mis-agentes') && (
              <div className="max-w-4xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h1 className="text-2xl font-bold text-white">Agentes de IA</h1>
                    <p className="text-gray-500 text-xs mt-1">Agentes con memoria persistente, system prompts y herramientas propias</p>
                  </div>
                  <Button onClick={handleOpenNewAgent}>+ Nuevo agente</Button>
                </div>
                {agentes.length === 0 ? (
                  <div className="bg-[#1a1a1a] border border-dashed border-[#333] rounded-xl p-16 text-center">
                    <div className="text-5xl mb-4">🤖</div>
                    <p className="text-gray-500 text-sm mb-4">Sin agentes todavía</p>
                    <Button onClick={handleOpenNewAgent} size="sm">Crear el primero</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {agentes.map(a => {
                      const d = a.data || {};
                      return (
                        <div key={a.id} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden hover:border-[#333] transition-colors">
                          <div className="p-4 flex items-center justify-between">
                            <div className="flex items-center space-x-3 cursor-pointer flex-1 min-w-0" onClick={() => handleOpenAgentChat(a)}>
                              <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-700 rounded-xl flex items-center justify-center text-white font-bold shrink-0">
                                {a.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-white truncate">{a.name}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Badge variant="green">● Activo</Badge>
                                  {d.modelo && <Badge variant="gray">{d.modelo}</Badge>}
                                  {d.busquedaWeb && <Badge variant="blue">🌐 Web</Badge>}
                                  {Array.isArray(d.allowedTools) && d.allowedTools.length > 0 && <Badge variant="gray">{d.allowedTools.length} tools</Badge>}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2 ml-4 shrink-0">
                              <Button variant="secondary" size="sm" onClick={() => handleToggleMemoria(a.id)}>🧠</Button>
                              <Button variant="secondary" size="sm" onClick={() => handleOpenEditAgent(a)}>✎ Editar</Button>
                              <Button variant="danger" size="sm" onClick={() => handleDeleteResource(a.id, 'agente')}>🗑</Button>
                            </div>
                          </div>
                          {expandedAgentId === a.id && (
                            <div className="border-t border-[#222] bg-[#161616] p-4">
                              <div className="flex justify-between mb-3">
                                <p className="text-[11px] font-bold text-gray-500 uppercase">Memoria persistente</p>
                                <Button variant="danger" size="sm" onClick={() => handleClearMemoria(a.id)}>Borrar todo</Button>
                              </div>
                              {(agentMemory[a.id]?.mensajes || []).length === 0 ? (
                                <p className="text-xs text-gray-600">Sin mensajes todavía.</p>
                              ) : (
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                  {(agentMemory[a.id]?.mensajes || []).map(m => (
                                    <div key={m.id} className={`text-xs p-2 rounded-lg ${m.role === 'assistant' ? 'bg-purple-900/20 text-purple-300 border border-purple-800/20' : 'bg-[#1e1e1e] text-gray-300 border border-[#2a2a2a]'}`}>
                                      <span className="font-bold uppercase mr-2 text-[10px]">{m.role === 'assistant' ? 'IA' : 'Tú'}</span>{m.content}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── RECURSOS GENÉRICOS ── */}
            {RESOURCE_SECTIONS.filter(s => ['sesion', 'memoria', 'credencial', 'entorno', 'implementacion'].includes(s.key) && s.key === activeTab).map(s => (
              <div key={s.key} className="max-w-4xl">
                <div className="flex justify-between items-center mb-6">
                  <h1 className="text-2xl font-bold text-white">{s.label}</h1>
                  <Button size="sm" onClick={() => handleCreateResource(s.key)}>+ Nuevo</Button>
                </div>
                {(resourcesByType[s.key] || []).length === 0 ? (
                  <div className="bg-[#1a1a1a] border border-dashed border-[#333] rounded-xl p-12 text-center">
                    <div className="text-4xl mb-3">{s.icon}</div>
                    <p className="text-gray-600 text-sm">Sin elementos en "{s.label}".</p>
                  </div>
                ) : (resourcesByType[s.key] || []).map(r => (
                  <div key={r.id} className="bg-[#1a1a1a] border border-[#2a2a2a] p-4 rounded-xl flex justify-between mb-2 hover:border-[#333]">
                    <div className="flex items-center space-x-3">
                      <span className="text-xl">{s.icon}</span>
                      <div><p className="font-bold text-white text-sm">{r.name}</p><p className="text-xs text-gray-600">{fmtDate(r.createdAt)}</p></div>
                    </div>
                    <Button variant="danger" size="sm" onClick={() => handleDeleteResource(r.id, s.key)}>🗑</Button>
                  </div>
                ))}
              </div>
            ))}

            {/* Archivo, lote */}
            {['archivo', 'lote'].includes(activeTab) && (() => {
              const s = RESOURCE_SECTIONS.find(x => x.key === activeTab)!;
              return (
                <div className="max-w-4xl">
                  <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-white">{s.label}</h1>
                    <Button size="sm" onClick={() => handleCreateResource(s.key)}>+ Nuevo</Button>
                  </div>
                  {(resourcesByType[s.key] || []).length === 0 ? (
                    <div className="bg-[#1a1a1a] border border-dashed border-[#333] rounded-xl p-12 text-center">
                      <div className="text-4xl mb-3">{s.icon}</div><p className="text-gray-600 text-sm">Sin elementos.</p>
                    </div>
                  ) : (resourcesByType[s.key] || []).map(r => (
                    <div key={r.id} className="bg-[#1a1a1a] border border-[#2a2a2a] p-4 rounded-xl flex justify-between mb-2 hover:border-[#333]">
                      <div className="flex items-center space-x-3">
                        <span className="text-xl">{s.icon}</span>
                        <div><p className="font-bold text-white text-sm">{r.name}</p><p className="text-xs text-gray-600">{fmtDate(r.createdAt)}</p></div>
                      </div>
                      <Button variant="danger" size="sm" onClick={() => handleDeleteResource(r.id, s.key)}>🗑</Button>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ── USO ── */}
            {activeTab === 'uso' && (
              <div className="max-w-4xl">
                <h1 className="text-2xl font-bold text-white mb-6">Uso general</h1>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 space-y-3">
                  {[['Créditos', fmtEUR(balance)], ['Gasto mes', fmtEUR(spend)], ['Claves activas', billing?.clavesActivas ?? 0], ...Object.entries(billing?.recursos || {}).map(([k, v]) => [k, v])].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between border-b border-[#222] pb-3 text-sm last:border-0">
                      <span className="text-gray-500 capitalize">{k}</span><span className="font-bold text-white">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── ORDENADOR DE ZOCO ── */}
            {activeTab === 'ordenador' && <OrdenadorZoco />}

            {/* ── DOCS ── */}
            {activeTab === 'docs' && (
              <div className="max-w-3xl">
                <h1 className="text-2xl font-bold text-white mb-6">Documentación</h1>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { title: 'Inicio rápido', desc: 'Empieza a usar la API de Zoco IA en minutos', icon: '🚀' },
                    { title: 'Referencia API', desc: 'Documentación completa de todos los endpoints', icon: '📋' },
                    { title: 'Guía de modelos', desc: 'Compara Zoco-Flash, Zoco-Plus, Zoco-Max y Zoco-Lab', icon: '🤖' },
                    { title: 'Ejemplos de código', desc: 'Snippets en Python, JavaScript y más', icon: '💻' },
                    { title: 'Límites y cuotas', desc: 'Información sobre rate limits y facturación', icon: '📊' },
                    { title: 'Soporte', desc: 'Contacta con el equipo de Zoco IA', icon: '💬' },
                  ].map(d => (
                    <div key={d.title} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 hover:border-[#444] cursor-pointer transition-colors">
                      <div className="text-2xl mb-3">{d.icon}</div>
                      <h3 className="font-bold text-white mb-1">{d.title}</h3>
                      <p className="text-gray-500 text-xs leading-relaxed">{d.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── ADMIN ── */}
            {activeTab === 'admin' && user?.isAdmin && (
              <div className="max-w-6xl">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 bg-red-900/40 rounded-xl flex items-center justify-center text-xl border border-red-800/30">🛡️</div>
                  <div>
                    <h1 className="text-2xl font-bold text-white">Panel de Administración</h1>
                    <p className="text-gray-500 text-xs">Control total de la plataforma Zoco IA</p>
                  </div>
                </div>
                {adminStats && (
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    {[['Usuarios', adminStats.totalUsuarios, '👥'], ['Ingresos', fmtEUR(adminStats.ingresosTotal || 0), '💰'], ['Llamadas hoy', adminStats.llamadasHoy || 0, '🤖'], ['Activos', adminStats.usuariosActivos || 0, '✅']].map(([l, v, ic]) => (
                      <div key={String(l)} className="bg-[#1a1a1a] border border-[#2a2a2a] p-4 rounded-xl">
                        <div className="text-gray-500 text-xs">{ic} {l}</div>
                        <div className="text-xl font-bold text-white mt-1">{v}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex space-x-1 bg-[#161616] p-1 rounded-lg mb-6 w-fit border border-[#222]">
                  {(['usuarios', 'pagos', 'sistema', 'logs'] as const).map(t => (
                    <button key={t} onClick={() => { setAdminTab(t); if (t === 'logs') load('/admin/logs', setAdminLogs); if (t === 'sistema') load('/admin/stats', setAdminStats); }}
                      className={`px-4 py-1.5 rounded-md text-xs font-medium ${adminTab === t ? 'bg-[#2a2a2a] text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                      {t === 'usuarios' ? '👥 Usuarios' : t === 'pagos' ? '💳 Pagos' : t === 'sistema' ? '⚙️ Sistema' : '📋 Logs'}
                    </button>
                  ))}
                </div>

                {adminTab === 'usuarios' && (
                  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-[#161616] border-b border-[#222] text-gray-500">
                        <tr>{['Usuario', 'Email', 'Rol', 'Créditos', 'Estado', 'Registro', 'Acciones'].map(h => <th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-[#1e1e1e]">
                        {adminUsuarios.map(u => (
                          <tr key={u.id} className="hover:bg-[#1e1e1e]">
                            <td className="px-4 py-3 font-medium text-white">{u.nombre}</td>
                            <td className="px-4 py-3 text-gray-500">{u.email}</td>
                            <td className="px-4 py-3"><Badge variant={u.isAdmin ? 'red' : u.isSupport ? 'blue' : 'gray'}>{u.isAdmin ? '👑 Admin' : u.isSupport ? '🛠 Soporte' : 'Cliente'}</Badge></td>
                            <td className="px-4 py-3 font-bold text-green-400">{fmtEUR(u.creditos)}</td>
                            <td className="px-4 py-3"><Badge variant={u.activo ? 'green' : 'red'}>{u.activo ? '● Activo' : '○ Inactivo'}</Badge></td>
                            <td className="px-4 py-3 text-gray-600">{fmtDate(u.createdAt)}</td>
                            <td className="px-4 py-3 space-x-2">
                              <Button variant="ghost" size="sm" onClick={() => handleAdminTopup(u.id, u.email)}>+Créditos</Button>
                              <Button variant={u.activo ? 'danger' : 'secondary'} size="sm" onClick={() => handleToggleUser(u)}>{u.activo ? 'Desactivar' : 'Activar'}</Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {adminTab === 'sistema' && adminStats && (
                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">
                      <h3 className="font-bold text-white mb-4">⚙️ Estado del sistema</h3>
                      <div className="space-y-3 text-xs">
                        {[['Backend', '● Online', 'text-green-400'], ['Motor IA', adminStats.ollamaOnline ? '🖥 Ollama local' : '⚠️ Ollama offline', 'text-blue-400'], ['Base de datos', 'SQLite + Volumen persistente', 'text-gray-300'], ['Pasarela de pago', adminStats.vivaConfigurado ? '✓ Viva.com' : '⚠️ No configurada', adminStats.vivaConfigurado ? 'text-green-400' : 'text-amber-400'], ['Usuarios', adminStats.totalUsuarios, 'text-white'], ['Ingresos', fmtEUR(adminStats.ingresosTotal || 0), 'text-green-400']].map(([k, v, c]) => (
                          <div key={String(k)} className="flex justify-between border-b border-[#222] pb-2">
                            <span className="text-gray-500">{k}</span><span className={String(c)}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">
                      <h3 className="font-bold text-white mb-4">🔑 Variables de entorno</h3>
                      <div className="space-y-2 text-xs font-mono">
                        {[['OLLAMA_BASE_URL', 'Motor IA local'], ['OLLAMA_MODEL_FLASH', 'Zoco-Flash'], ['OLLAMA_MODEL_PLUS', 'Zoco-Plus'], ['OLLAMA_MODEL_MAX', 'Zoco-Max'], ['OLLAMA_MODEL_LAB', 'Zoco-Lab'], ['JWT_SECRET', '✓ Configurado']].map(([k, v]) => (
                          <div key={k} className="flex justify-between p-2 bg-[#161616] rounded border border-[#222]">
                            <span className="text-purple-400">{k}</span><span className="text-gray-600">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {adminTab === 'logs' && (
                  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#222] flex justify-between items-center">
                      <span className="text-[11px] font-bold text-gray-500 uppercase">Últimas 100 transacciones</span>
                      <Button variant="ghost" size="sm" onClick={() => load('/admin/logs', setAdminLogs)}>↻ Actualizar</Button>
                    </div>
                    <div className="max-h-[500px] overflow-y-auto">
                      {adminLogs.length === 0 ? <p className="p-6 text-center text-gray-600 text-sm">Sin logs.</p> : (
                        <table className="w-full text-xs">
                          <thead className="bg-[#161616] border-b border-[#222] text-gray-500 sticky top-0">
                            <tr>{['Fecha', 'Usuario', 'Tipo', 'Importe', 'Descripción'].map(h => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
                          </thead>
                          <tbody className="divide-y divide-[#1a1a1a]">
                            {adminLogs.map((l: any) => (
                              <tr key={l.id} className="hover:bg-[#1e1e1e]">
                                <td className="px-4 py-2 text-gray-600">{fmtDate(l.created_at)}</td>
                                <td className="px-4 py-2 text-gray-500 font-mono">{l.user_id?.slice(0, 8)}...</td>
                                <td className="px-4 py-2"><Badge variant={l.kind === 'gasto' ? 'red' : 'green'}>{l.kind === 'gasto' ? '↓' : '↑'} {l.kind}</Badge></td>
                                <td className="px-4 py-2 font-medium text-white">{l.kind === 'gasto' ? '-' : '+'}{Math.abs(l.amount).toFixed(4)} €</td>
                                <td className="px-4 py-2 text-gray-600">{l.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}

                {adminTab === 'pagos' && (
                  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#222] bg-[#161616] text-xs font-bold text-gray-500 uppercase">Todos los pagos</div>
                    {(adminStats?.ultimosPagos || []).length === 0 ? <div className="p-8 text-center text-gray-600">Sin pagos.</div> : (
                      <table className="w-full text-xs">
                        <thead className="bg-[#161616] border-b border-[#222] text-gray-500">
                          <tr>{['Fecha', 'Usuario', 'Importe', 'Créditos', 'Estado', 'Proveedor'].map(h => <th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-[#1a1a1a]">
                          {(adminStats?.ultimosPagos || []).map((p: any) => (
                            <tr key={p.id} className="hover:bg-[#1e1e1e]">
                              <td className="px-4 py-3 text-gray-600">{fmtDate(p.created_at)}</td>
                              <td className="px-4 py-3 text-gray-400">{p.user_email || p.user_id?.slice(0, 8)}</td>
                              <td className="px-4 py-3 font-bold text-white">{fmtEUR(p.amount)}</td>
                              <td className="px-4 py-3 text-green-400">+{p.credits}</td>
                              <td className="px-4 py-3"><Badge variant={p.status === 'completed' ? 'green' : 'amber'}>{p.status === 'completed' ? '✓' : '⏳'} {p.status}</Badge></td>
                              <td className="px-4 py-3 text-gray-600">{p.provider}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </main>
      </div>
    </>
  );
}
