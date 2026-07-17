import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

interface Recurso { id: string; type: string; name: string; data: Record<string, any>; createdAt: string; }
interface ApiKey { id: string; name: string; display: string; revoked: boolean; createdAt: string; }
interface AdminUsuario { id: string; email: string; nombre: string; isAdmin: boolean; isSupport: boolean; creditos: number; activo: boolean; createdAt: string; }
interface BillingSummary { creditos: number; gastoEsteMes: number; recursos: Record<string, number>; clavesActivas: number; }
interface MemoriaMensaje { id: string; role: string; content: string; created_at: string; }
interface Payment { id: string; amount: number; credits: number; status: string; created_at: string; }
interface CreditPack { id: string; euros: number; credits: number; label: string; }
interface ChatMsg { role: string; content: string; }

function fmtEUR(n: number) { return `${(n || 0).toFixed(2)} €`; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('es-ES'); }

const MODELOS = [
  { id: 'zoco-lab', name: 'Zoco Lab', ollamaModel: 'Zoco-Lab', backend: 'zoco-lab', icon: '🧪', color: 'from-blue-500 to-indigo-600', tags: ['Rápido', 'Eficiente'], badge: 'Beta', nombre: 'Zoco Lab' },
  { id: 'zoco-max', name: 'Zoco Max', ollamaModel: 'Zoco-Max', backend: 'zoco-max', icon: '🚀', color: 'from-purple-600 to-pink-600', tags: ['Potente', 'Creativo'], badge: 'Pro', nombre: 'Zoco Max' },
  { id: 'zoco-plus', name: 'Zoco Plus', ollamaModel: 'Zoco-Plus', backend: 'zoco-plus', icon: '💎', color: 'from-amber-400 to-orange-600', tags: ['Equilibrado'], badge: 'Recomendado', nombre: 'Zoco Plus' },
  { id: 'zoco-flash', name: 'Zoco Flash', ollamaModel: 'Zoco-Flash', backend: 'zoco-flash', icon: '⚡', color: 'from-green-400 to-cyan-500', tags: ['Ultra-rápido'], badge: 'Nuevo', nombre: 'Zoco Flash' }
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

// Tipos de recurso que necesitan campo dinámico "tercer campo" en el formulario
const TIPOS_CON_VALOR = ['habilidad', 'credencial', 'entorno', 'implementacion', 'lote', 'memoria', 'archivo'];

// Configuración del tercer campo del modal: label + placeholder según el tipo de recurso.
// Sustituye el antiguo campo genérico "Valor / Clave API" por algo específico de cada módulo.
const CAMPO_VALOR_CONFIG: Record<string, { label: string; placeholder: string }> = {
  habilidad: {
    label: 'Clave API / Token de Acceso',
    placeholder: 'Pega aquí el token o identificador proporcionado por el proveedor (Tavily, Serper, etc.)...',
  },
  credencial: {
    label: 'Clave API / Token de Acceso',
    placeholder: 'Pega aquí el token o identificador proporcionado por el proveedor (Tavily, Serper, etc.)...',
  },
  entorno: {
    label: 'URL del Servidor / Endpoint',
    placeholder: 'Ej: https://ngrok-free.dev o https://zocoia.app...',
  },
  implementacion: {
    label: 'URL del Servidor / Endpoint',
    placeholder: 'Ej: https://ngrok-free.dev o https://zocoia.app...',
  },
  lote: {
    label: 'Configuración del Lote (JSON o Parámetros)',
    placeholder: 'Ej: {"max_concurrent": 3, "retry_attempts": 2} o parámetros de velocidad...',
  },
  memoria: {
    label: 'Identificador / Nombre del Índice de Vectores',
    placeholder: 'Ej: zoco_ia_memoria_index o nombre de la colección en la base de datos...',
  },
  archivo: {
    label: 'Ruta del Directorio / Ubicación del Archivo',
    placeholder: 'Ej: /app/data/storage/files o ruta del volumen persistente...',
  },
};

function getCampoValorConfig(modalType: string) {
  return CAMPO_VALOR_CONFIG[modalType] || { label: 'Valor', placeholder: 'Valor asociado a este recurso...' };
}

export default function Dashboard() {
  const { user, token, logout } = useAuth();

  // Guard de montaje. Nota: este proyecto es una SPA de Vite (sin SSR de Next.js),
  // así que los errores de hidratación #418/#423 no pueden producirse aquí — ese
  // fallo es específico de Next.js renderizando en servidor. Se deja este guard
  // por si en el futuro se migra a un framework con SSR, pero hoy no corrige nada.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

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
  const [expandedAgentId, setExpandedAgentId] = useState<string|null>(null);
  const [agentMemory, setAgentMemory] = useState<Record<string, {mensajes: MemoriaMensaje[]; cacheActiva: boolean}>>({});
  const [adminTab, setAdminTab] = useState<'usuarios'|'pagos'|'sistema'|'logs'>('usuarios');
  const [payingPack, setPayingPack] = useState<string|null>(null);
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

  // Clave de localStorage para el historial de chat: distinta por usuario y por agente
  // (o 'general' si es el chat sin agente), para que no se mezclen conversaciones.
  const chatStorageKey = `zoco_chat_history:${user?.id || 'anon'}:${activeAgent?.id || 'general'}`;

  // Al cambiar de agente (o al volver al chat general), restaura el historial guardado
  // en vez de empezar en blanco.
  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = localStorage.getItem(chatStorageKey);
      setChatMessages(saved ? JSON.parse(saved) : []);
    } catch {
      setChatMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, activeAgent?.id]);

  // Cada vez que cambian los mensajes, se guarda una copia en localStorage.
  useEffect(() => {
    if (!user?.id) return;
    try {
      if (chatMessages.length > 0) {
        localStorage.setItem(chatStorageKey, JSON.stringify(chatMessages));
      } else {
        localStorage.removeItem(chatStorageKey);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages, chatStorageKey]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [modalType, setModalType] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formValor, setFormValor] = useState('');

  const [formModelo, setFormModelo] = useState('zoco-plus');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formHabilidadesActivas, setFormHabilidadesActivas] = useState<string[]>([]);
  const [formNumPredict, setFormNumPredict] = useState(4096);
  const [formNumCtx, setFormNumCtx] = useState(8192);
  const [formTemperature, setFormTemperature] = useState(0.7);
  const [formBusquedaWeb, setFormBusquedaWeb] = useState(false);
  const [savingModal, setSavingModal] = useState(false);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const load = useCallback(async (url: string, setter: (d: any) => void) => {
    try {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (r.ok) { const data = await r.json(); setter(data); }
    } catch {}
  }, [authHeaders]);

  useEffect(() => {
    if (user?.modeloActivo) setSelectedModel(user.modeloActivo);
    load('/api/billing/summary', setBilling);
    load('/api/resources?type=agente', setAgentes);
    load('/api/payments/packs', setCreditPacks);
  }, [load, user?.modeloActivo]);

  useEffect(() => {
    if (activeTab === 'keys') load('/api/keys', setKeys);
    if (activeTab === 'billing') { load('/api/payments/history', setPayments); load('/api/billing/summary', setBilling); }
    if (activeTab === 'admin') { load('/admin/clientes', setAdminUsuarios); load('/admin/stats', setAdminStats); }
    if (activeTab !== 'chat') setActiveAgent(null);
    const rs = RESOURCE_SECTIONS.find(s => s.key === activeTab);
    if (rs) load(`/api/resources?type=${rs.key}`, d => setResourcesByType(p => ({ ...p, [rs.key]: d })));
  }, [activeTab, load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const ensureHabilidadesLoaded = useCallback(() => {
    if (!resourcesByType['habilidad']) {
      load('/api/resources?type=habilidad', d => setResourcesByType(p => ({ ...p, habilidad: d })));
    }
  }, [load, resourcesByType]);

  const resetForm = () => {
    setFormName('');
    setFormDesc('');
    setFormValor('');
    setFormModelo(selectedModel);
    setFormSystemPrompt('');
    setFormHabilidadesActivas([]);
    setFormNumPredict(4096);
    setFormNumCtx(8192);
    setFormTemperature(0.7);
    setFormBusquedaWeb(false);
  };

  const openCreateModal = (type: string) => {
    resetForm();
    setModalType(type);
    setModalMode('create');
    setEditingId(null);
    if (type === 'agente') ensureHabilidadesLoaded();
    setModalOpen(true);
  };

  const openEditModal = (item: Recurso) => {
    setModalType(item.type);
    setModalMode('edit');
    setEditingId(item.id);
    setFormName(item.name || '');
    setFormDesc(item.data?.descripcion || '');
    setFormValor(item.data?.valor || item.data?.apiKey || '');
    setFormModelo(item.data?.modelo || selectedModel);
    setFormSystemPrompt(item.data?.systemPrompt || '');
    setFormHabilidadesActivas(item.data?.habilidadesActivas || []);
    setFormNumPredict(item.data?.num_predict ?? 4096);
    setFormNumCtx(item.data?.num_ctx ?? 8192);
    setFormTemperature(item.data?.temperature ?? 0.7);
    setFormBusquedaWeb(!!item.data?.busquedaWeb);
    if (item.type === 'agente') ensureHabilidadesLoaded();
    setModalOpen(true);
  };

  const openEditKeyModal = (k: ApiKey) => {
    resetForm();
    setModalType('apikey');
    setModalMode('edit');
    setEditingId(k.id);
    setFormName(k.name);
    setModalOpen(true);
  };

  const toggleHabilidadForm = (habilidadId: string) => {
    setFormHabilidadesActivas(prev =>
      prev.includes(habilidadId) ? prev.filter(id => id !== habilidadId) : [...prev, habilidadId]
    );
  };

  const closeModal = () => { setModalOpen(false); setEditingId(null); };

  const handleSaveResource = async () => {
    if (!formName.trim()) { alert('El nombre es obligatorio'); return; }
    if (TIPOS_CON_VALOR.includes(modalType) && !formValor.trim()) { alert(`${getCampoValorConfig(modalType).label} es obligatorio`); return; }

    setSavingModal(true);
    try {
      if (modalType === 'apikey') {
        if (modalMode === 'create') {
          const r = await fetch(`${API_BASE}/api/keys`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: formName }) });
          if (r.ok) {
            const d = await r.json();
            alert(`Guarda esta clave (no se volverá a mostrar):\n\n${d.key}`);
            load('/api/keys', setKeys);
          } else { const e = await r.json(); alert(e.error || 'Error'); }
        } else {
          const r = await fetch(`${API_BASE}/api/keys/${editingId}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ name: formName }) });
          if (r.ok) load('/api/keys', setKeys);
          else alert('No se pudo renombrar la clave (verifica que el backend soporte PUT /api/keys/:id).');
        }
        closeModal();
        return;
      }

      const data: Record<string, any> = { descripcion: formDesc };
      if (TIPOS_CON_VALOR.includes(modalType)) data.valor = formValor;
      if (modalType === 'agente') {
        data.modelo = formModelo;
        data.systemPrompt = formSystemPrompt;
        data.habilidadesActivas = formHabilidadesActivas;
        data.num_predict = formNumPredict;
        data.num_ctx = formNumCtx;
        data.temperature = formTemperature;
        data.busquedaWeb = formBusquedaWeb;
      }
      const payload = { type: modalType, name: formName, data };

      if (modalMode === 'create') {
        const r = await fetch(`${API_BASE}/api/resources`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
        if (r.ok) {
          const created = await r.json();
          if (modalType === 'agente') setAgentes(p => [...p, created]);
          else setResourcesByType(p => ({ ...p, [modalType]: [...(p[modalType] || []), created] }));
          load('/api/billing/summary', setBilling);
        } else { const e = await r.json(); alert(e.error || 'Error'); }
      } else {
        const r = await fetch(`${API_BASE}/api/resources/${editingId}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
        if (r.ok) {
          const updated = await r.json();
          if (modalType === 'agente') setAgentes(p => p.map(a => a.id === editingId ? updated : a));
          else setResourcesByType(p => ({ ...p, [modalType]: (p[modalType] || []).map(x => x.id === editingId ? updated : x) }));
        } else { const e = await r.json(); alert(e.error || 'Error al actualizar'); }
      }
      closeModal();
    } finally {
      setSavingModal(false);
    }
  };

  const handleDeleteResource = async (id: string, type: string) => {
    if (!confirm('¿Eliminar?')) return;
    const r = await fetch(`${API_BASE}/api/resources/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (r.ok) {
      if (type === 'agente') {
        setAgentes(p => p.filter(a => a.id !== id));
        if (activeAgent?.id === id) { setActiveAgent(null); setChatMessages([]); }
      }
      else setResourcesByType(p => ({ ...p, [type]: (p[type] || []).filter(x => x.id !== id) }));
      load('/api/billing/summary', setBilling);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('¿Revocar esta clave?')) return;
    const r = await fetch(`${API_BASE}/api/keys/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (r.ok) setKeys(p => p.filter(k => k.id !== id));
  };

  const handleSelectModel = async (modelo: string) => {
    setSelectedModel(modelo);
    await fetch(`${API_BASE}/api/billing/model`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ modelo }) });
  };

  const handleBuyPack = async (packId: string) => {
    setPayingPack(packId);
    try {
      const r = await fetch(`${API_BASE}/api/payments/create`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ packId }) });
      if (r.ok) { const { url } = await r.json(); window.location.href = url; }
    } finally { setPayingPack(null); }
  };

  const handleOpenAgentChat = (a: Recurso) => {
    setActiveAgent(a);
    setActiveTab('chat');
  };

  const handleToggleMemoria = async (id: string) => {
    setExpandedAgentId(p => p === id ? null : id);
    if (expandedAgentId !== id && !agentMemory[id]) {
      const r = await fetch(`${API_BASE}/api/resources/${id}/memory`, { headers: authHeaders() });
      if (r.ok) { const d = await r.json(); setAgentMemory(p => ({ ...p, [id]: d })); }
    }
  };

  const handleClearMemoria = async (id: string) => {
    if (!confirm('¿Borrar memoria?')) return;
    const r = await fetch(`${API_BASE}/api/resources/${id}/memory`, { method: 'DELETE', headers: authHeaders() });
    if (r.ok) setAgentMemory(p => ({ ...p, [id]: { mensajes: [], cacheActiva: false } }));
  };

  const handleAdminTopup = async (id: string, email: string) => {
    const amount = prompt(`Créditos a añadir para ${email}:`, '10');
    if (!amount) return;
    const r = await fetch(`${API_BASE}/admin/topup`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ userId: id, amount: parseFloat(amount) }) });
    if (r.ok) load('/admin/clientes', setAdminUsuarios);
  };

  const handleToggleUser = async (u: AdminUsuario) => {
    const r = await fetch(`${API_BASE}/admin/clientes/${u.id}/toggle`, { method: 'POST', headers: authHeaders() });
    if (r.ok) load('/admin/clientes', setAdminUsuarios);
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role: 'user', content: chatInput };
    setChatMessages(p => [...p, userMsg]);
    setChatInput('');
    setChatLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          message: chatInput,
          agentId: activeAgent?.id,
          model: selectedModel,
          history: chatMessages
        })
      });
      if (r.ok) {
        const d = await r.json();
        setChatMessages(p => [...p, { role: 'assistant', content: d.response }]);
      }
    } finally { setChatLoading(false); }
  };

  const balance = billing?.creditos ?? 0;
  const spend = billing?.gastoEsteMes ?? 0;
  const balanceLow = balance <= 0.5;

  function IconAction({ children, onClick, title, danger }: { children: React.ReactNode, onClick: (e: React.MouseEvent) => void, title: string, danger?: boolean }) {
    return (
      <button onClick={(e) => { e.stopPropagation(); onClick(e); }} title={title}
        className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-colors text-xs ${danger ? 'border-red-900/30 text-red-500/70 hover:bg-red-500/10' : 'border-[#333] text-gray-500 hover:bg-[#252525] hover:text-gray-300'}`}>
        {children}
      </button>
    );
  }

  if (!isMounted) return null;

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] text-gray-300 font-sans selection:bg-purple-500/30">
      
      {/* SIDEBAR */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} flex flex-col border-r border-[#1a1a1a] bg-[#0d0d0d] transition-all duration-300 relative shrink-0`}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="w-8 h-8 bg-gradient-to-tr from-purple-600 to-blue-500 rounded-lg flex items-center justify-center text-white font-black text-xl shrink-0 shadow-lg shadow-purple-500/20">Z</div>
            {sidebarOpen && <span className="font-black text-white tracking-tighter text-xl">ZOCO IA</span>}
          </div>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-600 hover:text-gray-400 transition-colors">
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="pb-4">
            {sidebarOpen && <p className="px-3 text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-2">Principal</p>}
            <button onClick={() => setActiveTab('panel')} className={`w-full flex items-center ${sidebarOpen ? 'space-x-3 px-3' : 'justify-center'} py-2 rounded-xl transition-all ${activeTab === 'panel' ? 'bg-purple-600/10 text-purple-400 border border-purple-500/20' : 'hover:bg-[#161616] text-gray-500'}`}>
              <span className="text-lg">🏠</span>
              {sidebarOpen && <span className="text-sm font-medium">Dashboard</span>}
            </button>
            <button onClick={() => setActiveTab('chat')} className={`w-full mt-1 flex items-center ${sidebarOpen ? 'space-x-3 px-3' : 'justify-center'} py-2 rounded-xl transition-all ${activeTab === 'chat' ? 'bg-purple-600/10 text-purple-400 border border-purple-500/20' : 'hover:bg-[#161616] text-gray-500'}`}>
              <span className="text-lg">💬</span>
              {sidebarOpen && <span className="text-sm font-medium">Chat Playground</span>}
            </button>
          </div>

          <div className="pb-4">
            <div className="flex items-center justify-between px-3 mb-2">
              {sidebarOpen && <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Agentes</p>}
              {sidebarOpen && <button onClick={() => setAgentsExpanded(!agentsExpanded)} className="text-[10px] text-gray-700 hover:text-gray-500">{agentsExpanded ? '▼' : '▶'}</button>}
            </div>
            {agentsExpanded && (
              <>
                <button onClick={() => setActiveTab('agentes')} className={`w-full flex items-center ${sidebarOpen ? 'space-x-3 px-3' : 'justify-center'} py-2 rounded-xl transition-all ${activeTab === 'agentes' ? 'bg-purple-600/10 text-purple-400 border border-purple-500/20' : 'hover:bg-[#161616] text-gray-500'}`}>
                  <span className="text-lg">🤖</span>
                  {sidebarOpen && <span className="text-sm font-medium">Mis Agentes</span>}
                </button>
                {sidebarOpen && (agentes || []).slice(0, 5).map(a => (
                  <button key={a.id} onClick={() => handleOpenAgentChat(a)} className="w-full flex items-center space-x-3 px-4 py-1.5 text-xs text-gray-600 hover:text-purple-400 transition-colors truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500/40"></span>
                    <span className="truncate">{a.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="pb-4">
            <div className="flex items-center justify-between px-3 mb-2">
              {sidebarOpen && <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Recursos</p>}
              {sidebarOpen && <button onClick={() => setBuildExpanded(!buildExpanded)} className="text-[10px] text-gray-700 hover:text-gray-500">{buildExpanded ? '▼' : '▶'}</button>}
            </div>
            {buildExpanded && (RESOURCE_SECTIONS || []).map(s => (
              <button key={s.key} onClick={() => setActiveTab(s.key)} className={`w-full flex items-center ${sidebarOpen ? 'space-x-3 px-3' : 'justify-center'} py-2 rounded-xl transition-all ${activeTab === s.key ? 'bg-purple-600/10 text-purple-400 border border-purple-500/20' : 'hover:bg-[#161616] text-gray-500'}`}>
                <span className="text-lg">{s.icon}</span>
                {sidebarOpen && <span className="text-sm font-medium">{s.label}</span>}
              </button>
            ))}
          </div>

          <div className="pb-4">
            {sidebarOpen && <p className="px-3 text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-2">Configuración</p>}
            <button onClick={() => setActiveTab('keys')} className={`w-full flex items-center ${sidebarOpen ? 'space-x-3 px-3' : 'justify-center'} py-2 rounded-xl transition-all ${activeTab === 'keys' ? 'bg-purple-600/10 text-purple-400 border border-purple-500/20' : 'hover:bg-[#161616] text-gray-500'}`}>
              <span className="text-lg">🔑</span>
              {sidebarOpen && <span className="text-sm font-medium">API Keys</span>}
            </button>
            <button onClick={() => setActiveTab('billing')} className={`w-full mt-1 flex items-center ${sidebarOpen ? 'space-x-3 px-3' : 'justify-center'} py-2 rounded-xl transition-all ${activeTab === 'billing' ? 'bg-purple-600/10 text-purple-400 border border-purple-500/20' : 'hover:bg-[#161616] text-gray-500'}`}>
              <span className="text-lg">💳</span>
              {sidebarOpen && <span className="text-sm font-medium">Facturación</span>}
            </button>
            {user?.isAdmin && (
              <button onClick={() => setActiveTab('admin')} className={`w-full mt-1 flex items-center ${sidebarOpen ? 'space-x-3 px-3' : 'justify-center'} py-2 rounded-xl transition-all ${activeTab === 'admin' ? 'bg-red-600/10 text-red-400 border border-red-500/20' : 'hover:bg-[#161616] text-gray-500'}`}>
                <span className="text-lg">🛡️</span>
                {sidebarOpen && <span className="text-sm font-medium">Admin Panel</span>}
              </button>
            )}
          </div>
        </nav>

        {sidebarOpen && (
          <div className="p-4 border-t border-[#1a1a1a] bg-[#0a0a0a]">
            {balanceLow && (
              <div className="bg-amber-900/30 border border-amber-700/40 rounded-lg p-2.5 text-[11px] text-amber-300 mb-3">
                ⚠️ Saldo bajo ({fmtEUR(balance)}). <button onClick={() => setActiveTab('billing')} className="underline">Añadir fondos</button>
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
            <div className="flex items-center justify-between text-[11px] mt-2">
              <span className={`font-bold ${balanceLow ? 'text-amber-400' : 'text-green-400'}`}>{fmtEUR(balance)}</span>
              <button onClick={() => setActiveTab('billing')} className="text-purple-400 hover:text-purple-300">+ Añadir fondos</button>
            </div>
          </div>
        )}
      </aside>

      {/* MAIN */}
      <main className="flex-1 overflow-y-auto h-full bg-[#111111]">

        {notification && (
          <div className="bg-[#1a1a2e] border-b border-[#333] px-6 py-2.5 flex items-center justify-between text-[12px]">
            <span className="text-blue-300">ℹ️ Zoco IA Console activo · Groq Cloud IA en línea · {(agentes || []).length} agentes registrados</span>
            <button onClick={() => setNotification(false)} className="text-gray-600 hover:text-gray-400">✕</button>
          </div>
        )}

        <div className="p-8">

          {activeTab === 'panel' && (
            <>
              <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold text-white">Buenos días, {user?.nombre?.split(' ')[0] || 'Maria'}</h1>
                <div className="flex items-center space-x-2">
                  <button onClick={() => setActiveTab('docs')} className="flex items-center space-x-1.5 px-3 py-1.5 border border-[#333] rounded-lg text-gray-400 hover:text-gray-200 hover:border-[#555] text-xs">
                    <span>📖</span><span>Documentación</span>
                  </button>
                  <button onClick={() => setActiveTab('keys')} className="flex items-center space-x-1.5 px-3 py-1.5 border border-[#333] rounded-lg text-gray-400 hover:text-gray-200 hover:border-[#555] text-xs">
                    <span>🔑</span><span>Obtener clave de API</span>
                  </button>
                  <button onClick={() => openCreateModal('agente')} className="flex items-center space-x-1.5 px-3 py-1.5 bg-white text-black rounded-lg font-medium hover:bg-gray-200 text-xs">
                    <span>🤖</span><span>Crear un agente</span>
                  </button>
                </div>
              </div>

              {balanceLow && (
                <div className="mb-6 bg-amber-950/40 border border-amber-700/50 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-amber-400 text-lg">⚠️</span>
                    <div>
                      <p className="text-amber-300 font-medium text-sm">Tienes un saldo pendiente de {fmtEUR(Math.abs(balance))}.</p>
                      <p className="text-amber-400/70 text-xs mt-0.5">Añade fondos para reanudar el acceso a la API.</p>
                    </div>
                  </div>
                  <button onClick={() => setActiveTab('billing')} className="bg-amber-500 text-black px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-amber-400">Añadir fondos</button>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-500 text-xs">Créditos de la organización</span>
                    <span className="text-gray-600 text-xs">ℹ</span>
                  </div>
                  <div className={`text-2xl font-bold ${balanceLow ? 'text-amber-400' : 'text-white'}`}>{fmtEUR(balance)}</div>
                  <button onClick={() => setActiveTab('billing')} className="text-purple-400 text-xs hover:underline mt-2 block">Añadir fondos →</button>
                  <button className="text-gray-600 text-xs mt-0.5 hover:text-gray-400">Activar recarga automática</button>
                </div>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-500 text-xs">Gasto este mes</span>
                    <span className="text-xs text-gray-600">0% utilizado</span>
                  </div>
                  <div className="text-2xl font-bold text-white">{fmtEUR(spend)}</div>
                  <div className="text-gray-600 text-xs mt-2">de límite · se restablece el 1 ago</div>
                  <div className="w-full bg-[#2a2a2a] rounded-full h-1 mt-3">
                    <div className="bg-purple-500 h-1 rounded-full" style={{ width: `${Math.min(100, (spend / 200) * 100)}%` }}></div>
                  </div>
                </div>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-500 text-xs">Volumen de tokens</span>
                    <span className="text-red-400 text-xs">↓ 100%</span>
                  </div>
                  <div className="text-2xl font-bold text-white">{billing?.clavesActivas ?? 0}</div>
                  <div className="text-gray-600 text-xs mt-2">claves activas · {Object.values(billing?.recursos || {}).reduce((a,b)=>a+b,0)} recursos</div>
                </div>
              </div>

              <h2 className="text-lg font-bold text-white mb-4">Modelos</h2>
              <div className="grid grid-cols-4 gap-4 mb-8">
                {(MODELOS || []).map(m => {
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
                          {m.badge && <span className="bg-purple-900/50 text-purple-300 text-[9px] px-1.5 py-0.5 rounded border border-purple-700/40">{m.badge}</span>}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(m.tags || []).map(t => <span key={t} className="bg-[#252525] text-gray-400 text-[10px] px-1.5 py-0.5 rounded border border-[#333]">{t}</span>)}
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
                      {r.badge && <span className="bg-blue-900/50 text-blue-300 text-[9px] px-1.5 py-0.5 rounded">{r.badge}</span>}
                    </div>
                    <p className="text-gray-500 text-[11px] leading-relaxed">{r.desc}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'chat' && (
            <div className="max-w-3xl mx-auto flex flex-col" style={{height: 'calc(100vh - 120px)'}}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h1 className="text-xl font-bold text-white">
                    {activeAgent ? `Chat con ${activeAgent.name}` : 'Chat con Zoco IA'}
                  </h1>
                  {activeAgent && (
                    <button
                      onClick={() => { setActiveAgent(null); setChatMessages([]); }}
                      className="text-xs text-purple-400 hover:underline mt-0.5"
                    >
                      ← Volver al chat general
                    </button>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-500">Modelo:</span>
                  <select value={selectedModel} onChange={e => handleSelectModel(e.target.value)}
                    className="bg-[#1a1a1a] border border-[#333] text-gray-300 text-xs px-2 py-1 rounded-lg">
                    {(MODELOS || []).map(m => <option key={m.backend} value={m.backend}>{m.nombre}</option>)}
                  </select>
                  <button onClick={() => setChatMessages([])} className="text-gray-600 hover:text-red-400 text-xs border border-[#333] px-2 py-1 rounded-lg">🗑 Limpiar</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4 mb-4 space-y-4">
                {(chatMessages || []).length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center text-gray-600">
                    <div className="text-5xl mb-4">{activeAgent ? activeAgent.name.charAt(0).toUpperCase() : 'Z'}</div>
                    <p className="text-gray-400 font-medium">{activeAgent ? `${activeAgent.name} listo` : 'Zoco IA listo'}</p>
                    <p className="text-xs mt-1 text-gray-600">Modelo: {(MODELOS || []).find(m => m.backend === selectedModel)?.nombre || selectedModel}</p>
                    <p className="text-xs mt-0.5 text-gray-700 font-mono">Ollama: {(MODELOS || []).find(m => m.backend === selectedModel)?.ollamaModel || 'llama3.2'} · Groq fallback: llama-3.3-70b</p>
                    {activeAgent
                      ? <p className="text-xs mt-1 text-gray-600">🧠 Memoria persistente de este agente activada</p>
                      : <p className="text-xs mt-1 text-gray-600">🌐 Búsqueda web automática activada</p>}
                  </div>
                )}
                {(chatMessages || []).map((m, i) => (
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
                    <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-0.5 shrink-0">
                      {activeAgent ? activeAgent.name.charAt(0).toUpperCase() : 'Z'}
                    </div>
                    <div className="bg-[#252525] border border-[#333] px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm text-gray-500">
                      <span className="inline-flex space-x-1"><span className="animate-bounce">●</span><span className="animate-bounce" style={{animationDelay:'0.1s'}}>●</span><span className="animate-bounce" style={{animationDelay:'0.2s'}}>●</span></span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="flex space-x-2">
                <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                  placeholder="Escribe un mensaje... (Intro para enviar)" disabled={chatLoading}
                  className="flex-1 bg-[#1a1a1a] border border-[#333] text-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50 placeholder-gray-600" />
                <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                  className="bg-purple-600 text-white px-5 py-3 rounded-xl font-medium text-sm hover:bg-purple-500 disabled:opacity-40 transition-colors">
                  ➤
                </button>
              </div>
            </div>
          )}

          {activeTab === 'keys' && (
            <div className="max-w-4xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-white">API Keys</h1>
                  <p className="text-gray-500 text-xs mt-1">Claves secretas para autenticarte en la API de Zoco IA</p>
                </div>
                <button onClick={() => openCreateModal('apikey')} className="bg-white text-black px-4 py-2 rounded-lg font-medium text-xs hover:bg-gray-200">+ Nueva clave</button>
              </div>
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
                {(keys || []).length === 0 ? (
                  <div className="p-10 text-center text-gray-600">No tienes claves de API todavía.</div>
                ) : (keys || []).map(k => (
                  <div key={k.id} className="flex items-center justify-between p-4 border-b border-[#222] last:border-0 hover:bg-[#1e1e1e]">
                    <div>
                      <p className="font-medium text-white">{k.name}</p>
                      <p className="text-xs text-gray-600 mt-0.5">Creada el {fmtDate(k.createdAt)}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <code className="bg-[#252525] border border-[#333] px-3 py-1 rounded text-xs text-gray-400">{k.display}</code>
                      <IconAction title="Editar" onClick={() => openEditKeyModal(k)}>✏️</IconAction>
                      <button onClick={() => handleDeleteKey(k.id)} className="text-red-500/70 hover:text-red-400 text-xs border border-red-900/40 px-2 py-1 rounded hover:border-red-700/40">Revocar</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'billing' && (
            <div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-white mb-2">Facturación y créditos</h1>
              <p className="text-gray-500 text-xs mb-6">Los créditos se añaden automáticamente al confirmar el pago con Visa/Mastercard.</p>
              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 col-span-1">
                  <div className="text-gray-500 text-xs mb-2">Saldo actual</div>
                  <div className={`text-3xl font-bold ${balanceLow ? 'text-amber-400' : 'text-green-400'}`}>{fmtEUR(balance)}</div>
                  <div className="text-gray-600 text-xs mt-2">Gasto este mes: {fmtEUR(spend)}</div>
                </div>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 col-span-2">
                  <div className="text-gray-500 text-xs mb-3">Estado de la cuenta</div>
                  <div className="space-y-2 text-xs">
                    {[
                      ['Claves activas', billing?.clavesActivas ?? 0],
                      ['Recursos totales', Object.values(billing?.recursos || {}).reduce((a,b)=>a+b,0)],
                      ['Pagos realizados', (payments || []).filter(p=>p.status==='completed').length]
                    ].map(([k,v]) => (
                      <div key={String(k)} className="flex justify-between border-b border-[#222] pb-2">
                        <span className="text-gray-500">{k}</span><span className="font-bold text-white">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <h2 className="text-base font-bold text-white mb-4">Paquetes de créditos</h2>
              <div className="grid grid-cols-5 gap-3 mb-8">
                {((creditPacks || []).length > 0 ? creditPacks : [
                  {id:'starter',euros:5,credits:5,label:'Starter'},{id:'basic',euros:10,credits:11,label:'Basic'},
                  {id:'pro',euros:25,credits:28,label:'Pro'},{id:'business',euros:50,credits:60,label:'Business'},{id:'enterprise',euros:100,credits:125,label:'Enterprise'}
                ]).map(pack => (
                  <div key={pack.id} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4 flex flex-col items-center text-center hover:border-purple-700/50 transition-colors">
                    <p className="font-bold text-white text-xs">{pack.label}</p>
                    <p className="text-2xl font-bold text-white mt-2">{pack.euros}€</p>
                    <p className="text-green-400 text-xs font-medium mt-1">{pack.credits} créditos</p>
                    {pack.credits > pack.euros && <p className="text-purple-400 text-[10px] mt-0.5">+{pack.credits-pack.euros} bonus</p>}
                    <button onClick={() => handleBuyPack(pack.id)} disabled={payingPack === pack.id}
                      className="mt-3 w-full bg-purple-600 text-white py-1.5 rounded-lg text-xs font-medium hover:bg-purple-500 disabled:opacity-50">
                      {payingPack === pack.id ? '...' : 'Comprar'}
                    </button>
                  </div>
                ))}
              </div>
              <h2 className="text-base font-bold text-white mb-4">Historial de pagos</h2>
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
                {(payments || []).length === 0 ? <div className="p-8 text-center text-gray-600 text-sm">Sin pagos todavía.</div> : (
                  <table className="w-full text-xs">
                    <thead className="bg-[#161616] border-b border-[#222] text-gray-500">
                      <tr>{['Fecha','Importe','Créditos','Estado'].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e1e1e]">
                      {(payments || []).map(p=>(
                        <tr key={p.id} className="hover:bg-[#1e1e1e]">
                          <td className="px-4 py-3 text-gray-500">{fmtDate(p.created_at)}</td>
                          <td className="px-4 py-3 font-medium text-white">{fmtEUR(p.amount)}</td>
                          <td className="px-4 py-3 text-green-400 font-medium">+{p.credits}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${p.status==='completed'?'bg-green-900/40 text-green-400':'bg-yellow-900/40 text-yellow-400'}`}>
                              {p.status==='completed'?'✓ Completado':'⏳ Pendiente'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {(activeTab === 'agentes' || activeTab === 'mis-agentes') && (
            <div className="max-w-4xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-white">Agentes de IA</h1>
                  <p className="text-gray-500 text-xs mt-1">Agentes con memoria persistente conectados a Zoco IA · haz clic en una tarjeta para chatear con ese agente</p>
                </div>
                <button onClick={() => openCreateModal('agente')} className="bg-white text-black px-4 py-2 rounded-lg text-xs font-medium hover:bg-gray-200">+ Nuevo agente</button>
              </div>
              {(agentes || []).length === 0 ? (
                <div className="bg-[#1a1a1a] border border-dashed border-[#333] rounded-xl p-16 text-center">
                  <div className="text-5xl mb-4">🤖</div>
                  <p className="text-gray-500 text-sm">No tienes agentes todavía.</p>
                  <button onClick={() => openCreateModal('agente')} className="mt-4 text-purple-400 text-xs hover:underline">Crear el primero →</button>
                </div>
              ) : (agentes || []).map(a => (
                <div
                  key={a.id}
                  onClick={() => handleOpenAgentChat(a)}
                  className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden mb-3 cursor-pointer hover:border-purple-600/50 transition-colors"
                >
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-700 rounded-xl flex items-center justify-center text-white font-bold">
                        {a.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-white">{a.name}</p>
                        <p className="text-xs text-gray-600 font-mono">{a.id.slice(0,16)}...</p>
                        {a.data?.modelo && <p className="text-[10px] text-purple-400 mt-0.5">{a.data.modelo}</p>}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="bg-green-900/30 text-green-400 text-[10px] px-2 py-0.5 rounded-full border border-green-800/30">● Activo</span>
                      <IconAction title="Memoria" onClick={() => handleToggleMemoria(a.id)}>🧠 Memoria</IconAction>
                      <IconAction title="Editar" onClick={() => openEditModal(a)}>✏️</IconAction>
                      <IconAction title="Eliminar" danger onClick={() => handleDeleteResource(a.id, 'agente')}>🗑</IconAction>
                    </div>
                  </div>
                  {expandedAgentId === a.id && (
                    <div onClick={(e) => e.stopPropagation()} className="border-t border-[#222] bg-[#161616] p-4">
                      <div className="flex justify-between mb-3">
                        <p className="text-[11px] font-bold text-gray-500 uppercase">Memoria persistente</p>
                        <button onClick={() => handleClearMemoria(a.id)} className="text-red-500/70 hover:text-red-400 text-xs">Borrar todo</button>
                      </div>
                      {(agentMemory[a.id]?.mensajes || []).length === 0
                        ? <p className="text-xs text-gray-600">Sin mensajes todavía.</p>
                        : <div className="space-y-2 max-h-48 overflow-y-auto">
                            {(agentMemory[a.id]?.mensajes || []).map(m => (
                              <div key={m.id} className={`text-xs p-2 rounded-lg ${m.role==='assistant'?'bg-purple-900/20 text-purple-300 border border-purple-800/20':'bg-[#1e1e1e] text-gray-300 border border-[#2a2a2a]'}`}>
                                <span className="font-bold uppercase mr-2 text-[10px]">{m.role==='assistant'?'IA':'Tú'}</span>{m.content}
                              </div>
                            ))}
                          </div>
                      }
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {(RESOURCE_SECTIONS || []).filter(s => !['sesion','memoria','credencial','entorno','implementacion'].includes(s.key) ? false : s.key === activeTab).map(s => (
            <div key={s.key} className="max-w-4xl">
              <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-white">{s.label}</h1>
                <button onClick={() => openCreateModal(s.key)} className="bg-white text-black px-4 py-2 rounded-lg text-xs font-medium">+ Nuevo</button>
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
                  <div className="flex items-center space-x-2">
                    <IconAction title="Editar" onClick={() => openEditModal(r)}>✏️</IconAction>
                    <IconAction title="Eliminar" danger onClick={() => handleDeleteResource(r.id, s.key)}>🗑</IconAction>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {['archivo','habilidad','lote'].includes(activeTab) && (() => {
            const s = (RESOURCE_SECTIONS || []).find(x => x.key === activeTab)!;
            return (
              <div className="max-w-4xl">
                <div className="flex justify-between items-center mb-6">
                  <h1 className="text-2xl font-bold text-white">{s.label}</h1>
                  <button onClick={() => openCreateModal(s.key)} className="bg-white text-black px-4 py-2 rounded-lg text-xs font-medium">+ Nuevo</button>
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
                    <div className="flex items-center space-x-2">
                      <IconAction title="Editar" onClick={() => openEditModal(r)}>✏️</IconAction>
                      <IconAction title="Eliminar" danger onClick={() => handleDeleteResource(r.id, s.key)}>🗑</IconAction>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {activeTab === 'uso' && (
            <div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-white mb-6">Uso general</h1>
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 space-y-3">
                {[
                  ['Créditos disponibles', fmtEUR(balance)],
                  ['Gasto este mes', fmtEUR(spend)],
                  ['Claves activas', billing?.clavesActivas ?? 0],
                  ...Object.entries(billing?.recursos || {}).map(([k,v]) => [k,v])
                ].map(([k,v]) => (
                  <div key={String(k)} className="flex justify-between border-b border-[#222] pb-3 text-sm last:border-0">
                    <span className="text-gray-500 capitalize">{k}</span><span className="font-bold text-white">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'docs' && (
            <div className="max-w-3xl">
              <h1 className="text-2xl font-bold text-white mb-6">Documentación</h1>
              <div className="grid grid-cols-2 gap-4">
                {[
                  {title:'Inicio rápido',desc:'Empieza a usar la API de Zoco IA en minutos',icon:'🚀'},
                  {title:'Referencia API',desc:'Documentación completa de todos los endpoints',icon:'📋'},
                  {title:'Guía de modelos',desc:'Compara Zoco Lab, Max, Plus y Flash',icon:'🤖'},
                  {title:'Ejemplos de código',desc:'Snippets en Python, JavaScript y más',icon:'💻'},
                  {title:'Límites y cuotas',desc:'Información sobre rate limits y facturación',icon:'📊'},
                  {title:'Soporte',desc:'Contacta con el equipo de Zoco IA',icon:'💬'},
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
                  {[
                    ['Usuarios', adminStats.totalUsuarios, '👥'],
                    ['Ingresos', fmtEUR(adminStats.ingresosTotal || 0), '💰'],
                    ['Llamadas hoy', adminStats.llamadasHoy || 0, '🤖'],
                    ['Activos', adminStats.usuariosActivos || 0, '✅']
                  ].map(([l,v,ic]) => (
                    <div key={String(l)} className="bg-[#1a1a1a] border border-[#2a2a2a] p-4 rounded-xl">
                      <div className="text-gray-500 text-xs">{ic} {l}</div>
                      <div className="text-xl font-bold text-white mt-1">{v}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex space-x-1 bg-[#161616] p-1 rounded-lg mb-6 w-fit border border-[#222]">
                {(['usuarios','pagos','sistema','logs'] as const).map(t=>(
                  <button key={t} onClick={()=>{setAdminTab(t); if(t==='logs') load('/admin/logs',setAdminLogs); if(t==='sistema') load('/admin/stats',setAdminStats);}}
                    className={`px-4 py-1.5 rounded-md text-xs font-medium capitalize ${adminTab===t?'bg-[#2a2a2a] text-white':'text-gray-500 hover:text-gray-300'}`}>
                    {t==='usuarios'?'👥 Usuarios':t==='pagos'?'💳 Pagos':t==='sistema'?'⚙️ Sistema':'📋 Logs'}
                  </button>
                ))}
              </div>

              {adminTab === 'usuarios' && (
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-[#161616] border-b border-[#222] text-gray-500">
                      <tr>{['Usuario','Email','Rol','Créditos','Estado','Registro','Acciones'].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e1e1e]">
                      {(adminUsuarios || []).map(u=>(
                        <tr key={u.id} className="hover:bg-[#1e1e1e]">
                          <td className="px-4 py-3 font-medium text-white">{u.nombre}</td>
                          <td className="px-4 py-3 text-gray-500">{u.email}</td>
                          <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] border ${u.isAdmin?'bg-red-900/30 text-red-400 border-red-800/30':u.isSupport?'bg-blue-900/30 text-blue-400 border-blue-800/30':'bg-[#252525] text-gray-500 border-[#333]'}`}>{u.isAdmin?'👑 Admin':u.isSupport?'🛠 Soporte':'Cliente'}</span></td>
                          <td className="px-4 py-3 font-bold text-green-400">{fmtEUR(u.creditos)}</td>
                          <td className="px-4 py-3"><span className={`text-[10px] font-medium ${u.activo?'text-green-400':'text-red-400'}`}>{u.activo?'● Activo':'○ Inactivo'}</span></td>
                          <td className="px-4 py-3 text-gray-600">{fmtDate(u.createdAt)}</td>
                          <td className="px-4 py-3 space-x-2">
                            <button onClick={()=>handleAdminTopup(u.id,u.email)} className="text-green-500/70 hover:text-green-400 hover:underline">+Créditos</button>
                            <button onClick={()=>handleToggleUser(u)} className={`hover:underline ${u.activo?'text-red-500/70 hover:text-red-400':'text-green-500/70 hover:text-green-400'}`}>{u.activo?'Desactivar':'Activar'}</button>
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
                      {[
                        ['Backend', '● Online', 'text-green-400'],
                        ['Motor IA', adminStats.ollamaOnline ? '🖥 Ollama local' : '☁️ Groq Cloud', 'text-blue-400'],
                        ['Base de datos', 'SQLite + Volumen Railway', 'text-gray-300'],
                        ['Pasarela de pago', adminStats.vivaConfigurado ? '✓ Viva.com' : '⚠️ No configurada', adminStats.vivaConfigurado ? 'text-green-400' : 'text-amber-400'],
                        ['Total usuarios', adminStats.totalUsuarios, 'text-white'],
                        ['Ingresos totales', fmtEUR(adminStats.ingresosTotal || 0), 'text-green-400']
                      ].map(([k,v,c]) => (
                        <div key={String(k)} className="flex justify-between border-b border-[#222] pb-2">
                          <span className="text-gray-500">{k}</span><span className={String(c)}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6">
                    <h3 className="font-bold text-white mb-4">🔑 Variables de entorno</h3>
                    <div className="space-y-2 text-xs font-mono">
                      {[
                        ['GROQ_API_KEY', 'Motor IA cloud'],
                        ['OLLAMA_URL', 'Ollama/Ngrok local'],
                        ['VIVA_CLIENT_ID', 'Pagos'],
                        ['VIVA_CLIENT_SECRET', 'Pagos'],
                        ['VIVA_SOURCE_CODE', 'Pagos'],
                        ['JWT_SECRET', '✓ Configurado']
                      ].map(([k,v]) => (
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
                    <button onClick={() => load('/admin/logs', setAdminLogs)} className="text-xs text-purple-400 hover:underline">↻ Actualizar</button>
                  </div>
                  <div className="max-h-[500px] overflow-y-auto">
                    {(adminLogs || []).length === 0 ? <p className="p-6 text-center text-gray-600 text-sm">Sin logs.</p> : (
                      <table className="w-full text-xs">
                        <thead className="bg-[#161616] border-b border-[#222] text-gray-500 sticky top-0">
                          <tr>{['Fecha','Usuario','Tipo','Importe','Descripción'].map(h=><th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-[#1a1a1a]">
                          {(adminLogs || []).map((l:any)=>(
                            <tr key={l.id} className="hover:bg-[#1e1e1e]">
                              <td className="px-4 py-2 text-gray-600">{fmtDate(l.created_at)}</td>
                              <td className="px-4 py-2 text-gray-500 font-mono">{l.user_id?.slice(0,8)}...</td>
                              <td className="px-4 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] ${l.kind==='gasto'?'bg-red-900/30 text-red-400':'bg-green-900/30 text-green-400'}`}>{l.kind==='gasto'?'↓ Gasto':'↑ Recarga'}</span></td>
                              <td className="px-4 py-2 font-medium text-white">{l.kind==='gasto'?'-':'+'}{Math.abs(l.amount).toFixed(4)} €</td>
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
                  {(adminStats?.ultimosPagos||[]).length === 0 ? <div className="p-8 text-center text-gray-600">Sin pagos.</div> : (
                    <table className="w-full text-xs">
                      <thead className="bg-[#161616] border-b border-[#222] text-gray-500">
                        <tr>{['Fecha','Usuario','Importe','Créditos','Estado','Proveedor'].map(h=><th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-[#1a1a1a]">
                        {(adminStats?.ultimosPagos||[]).map((p:any)=>(
                          <tr key={p.id} className="hover:bg-[#1e1e1e]">
                            <td className="px-4 py-3 text-gray-600">{fmtDate(p.created_at)}</td>
                            <td className="px-4 py-3 text-gray-400">{p.user_email||p.user_id?.slice(0,8)}</td>
                            <td className="px-4 py-3 font-bold text-white">{fmtEUR(p.amount)}</td>
                            <td className="px-4 py-3 text-green-400">+{p.credits}</td>
                            <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] ${p.status==='completed'?'bg-green-900/30 text-green-400':'bg-yellow-900/30 text-yellow-400'}`}>{p.status==='completed'?'✓ Completado':'⏳ Pendiente'}</span></td>
                            <td className="px-4 py-3 text-gray-600 capitalize">{p.provider}</td>
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

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-gray-800 bg-[#121214] p-6 text-white shadow-2xl max-h-[85vh] overflow-y-auto">
            <h3 className="mb-4 text-xl font-black text-[#996dff]">
              {modalMode === 'create' ? '✨ Crear nuevo elemento' : '✏️ Editar registro'}
              <span className="text-xs block text-gray-500 font-mono mt-1 font-normal">
                {modalType === 'apikey' ? 'Clave de API' : (RESOURCE_SECTIONS || []).find(s => s.key === modalType)?.label || (modalType === 'agente' ? 'Agente' : modalType)}
              </span>
            </h3>

            <div className="mb-4">
              <label className="mb-1 block text-xs font-bold uppercase text-gray-400 tracking-wider">Nombre del recurso</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                className="w-full rounded border border-gray-800 bg-[#1a1a1e] p-2.5 text-sm text-white focus:border-[#996dff] focus:outline-none transition-colors"
                placeholder={modalType === 'agente' ? 'Ej: Especialista en Backend' : 'Ej: busqueda_web o Tavily API'}
              />
            </div>

            {modalType !== 'apikey' && (
              <div className="mb-4">
                <label className="mb-1 block text-xs font-bold uppercase text-gray-400 tracking-wider">Descripción</label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  className="w-full rounded border border-gray-800 bg-[#1a1a1e] p-2.5 text-sm text-white focus:border-[#996dff] focus:outline-none transition-colors"
                  placeholder="¿Qué función cumple o para qué sirve?"
                />
              </div>
            )}

            {TIPOS_CON_VALOR.includes(modalType) && (
              <div className="mb-4">
                <label className="mb-1 block text-xs font-bold uppercase text-gray-400 tracking-wider">{getCampoValorConfig(modalType).label}</label>
                <textarea
                  value={formValor}
                  onChange={e => setFormValor(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-gray-800 bg-[#1a1a1e] p-2.5 text-xs font-mono text-white focus:border-[#996dff] focus:outline-none transition-colors"
                  placeholder={getCampoValorConfig(modalType).placeholder}
                />
              </div>
            )}

            {modalType === 'agente' && (
              <>
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-400 tracking-wider">Modelo (Ollama)</label>
                  <select
                    value={formModelo}
                    onChange={e => setFormModelo(e.target.value)}
                    className="w-full rounded border border-gray-800 bg-[#1a1a1e] p-2.5 text-sm text-white focus:border-[#996dff] focus:outline-none transition-colors"
                  >
                    {(MODELOS || []).map(m => <option key={m.backend} value={m.backend}>{m.nombre} — {m.ollamaModel}</option>)}
                  </select>
                </div>
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-400 tracking-wider">System Prompt</label>
                  <textarea
                    value={formSystemPrompt}
                    onChange={e => setFormSystemPrompt(e.target.value)}
                    rows={4}
                    className="w-full rounded border border-gray-800 bg-[#1a1a1e] p-2.5 text-xs text-white focus:border-[#996dff] focus:outline-none transition-colors"
                    placeholder="Ej: Eres un asistente experto en programación..."
                  />
                </div>
                <div className="mb-4">
                  <label className="mb-2 block text-xs font-bold uppercase text-gray-400 tracking-wider">Habilidades disponibles</label>
                  <div className="space-y-1 max-h-32 overflow-y-auto p-2 bg-[#1a1a1e] rounded border border-gray-800">
                    {(resourcesByType['habilidad'] || []).length === 0 ? (
                      <p className="text-[10px] text-gray-600 italic">No hay habilidades creadas.</p>
                    ) : (resourcesByType['habilidad'] || []).map(h => (
                      <div key={h.id} onClick={() => toggleHabilidadForm(h.id)} className="flex items-center space-x-2 cursor-pointer group">
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${formHabilidadesActivas.includes(h.id) ? 'bg-[#996dff] border-[#996dff]' : 'border-gray-700 group-hover:border-gray-500'}`}>
                          {formHabilidadesActivas.includes(h.id) && <span className="text-[10px]">✓</span>}
                        </div>
                        <span className="text-xs text-gray-400 group-hover:text-gray-200">{h.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">Temp</label>
                    <input type="number" step="0.1" value={formTemperature} onChange={e => setFormTemperature(parseFloat(e.target.value))} className="w-full rounded border border-gray-800 bg-[#1a1a1e] p-2 text-xs text-white" />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center space-x-2 cursor-pointer mb-2">
                      <input type="checkbox" checked={formBusquedaWeb} onChange={e => setFormBusquedaWeb(e.target.checked)} className="rounded border-gray-800 bg-[#1a1a1e] text-[#996dff]" />
                      <span className="text-[10px] font-bold uppercase text-gray-500">Búsqueda Web</span>
                    </label>
                  </div>
                </div>
              </>
            )}

            <div className="mt-6 flex space-x-3">
              <button onClick={closeModal} className="flex-1 rounded-lg border border-gray-800 py-2.5 text-xs font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-800 transition-colors">Cancelar</button>
              <button onClick={handleSaveResource} disabled={savingModal} className="flex-1 rounded-lg bg-[#996dff] py-2.5 text-xs font-bold uppercase tracking-widest text-white shadow-lg shadow-purple-500/20 hover:bg-[#8359e6] disabled:opacity-50 transition-colors">
                {savingModal ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #222; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #333; }
      `}</style>
    </div>
  );
}
