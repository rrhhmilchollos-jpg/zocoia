import React, { useState, useEffect, useCallback } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

interface Recurso { id: string; type: string; name: string; data: Record<string, any>; createdAt: string; }
interface ApiKey { id: string; name: string; display: string; revoked: boolean; createdAt: string; }
interface AdminUsuario { id: string; email: string; nombre: string; isAdmin: boolean; isSupport: boolean; creditos: number; activo: boolean; createdAt: string; }
interface BillingSummary { creditos: number; gastoEsteMes: number; recursos: Record<string, number>; clavesActivas: number; }
interface MemoriaMensaje { id: string; role: string; content: string; created_at: string; }
interface Payment { id: string; amount: number; credits: number; status: string; created_at: string; }
interface CreditPack { id: string; euros: number; credits: number; label: string; }

const RESOURCE_TABS = [
  { key: 'archivo', label: 'Archivos', icon: 'fa-folder' },
  { key: 'habilidad', label: 'Habilidades', icon: 'fa-bolt' },
  { key: 'lote', label: 'Lotes', icon: 'fa-layer-group' },
  { key: 'sesion', label: 'Sesiones', icon: 'fa-comments' },
  { key: 'implementacion', label: 'Implementaciones', icon: 'fa-rocket' },
  { key: 'entorno', label: 'Entornos', icon: 'fa-globe' },
  { key: 'credencial', label: 'Credenciales', icon: 'fa-vault' },
  { key: 'memoria', label: 'Memoria', icon: 'fa-brain' },
];

function fmtEUR(n: number) { return `${(n || 0).toFixed(2)} €`; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('es-ES'); }

export default function Dashboard() {
  const { user, token, logout } = useAuth();
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [agentes, setAgentes] = useState<Recurso[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [resourcesByType, setResourcesByType] = useState<Record<string, Recurso[]>>({});
  const [adminUsuarios, setAdminUsuarios] = useState<AdminUsuario[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [creditPacks, setCreditPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState<'checking'|'online'|'offline'>('checking');
  const [activeTab, setActiveTab] = useState('panel');
  const [selectedModel, setSelectedModel] = useState('maris-core-7b');
  const [expandedAgentId, setExpandedAgentId] = useState<string|null>(null);
  const [agentMemory, setAgentMemory] = useState<Record<string, { mensajes: MemoriaMensaje[]; cacheActiva: boolean }>>({});
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [notification, setNotification] = useState(true);
  const [adminTab, setAdminTab] = useState<'usuarios'|'pagos'|'sistema'|'logs'>('usuarios');
  const [adminLogs, setAdminLogs] = useState<any[]>([]);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [payingPack, setPayingPack] = useState<string|null>(null);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const loadBilling = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/api/billing/summary`, { headers: authHeaders() }); if (r.ok) { const data = await r.json(); setBilling(data); } } catch {}
  }, [authHeaders]);

  const loadAgentes = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/api/resources?type=agente`, { headers: authHeaders() }); if (r.ok) { const data = await r.json(); setAgentes(data); } } catch {}
  }, [authHeaders]);

  const loadKeys = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/api/keys`, { headers: authHeaders() }); if (r.ok) { const data = await r.json(); setKeys(data); } } catch {}
  }, [authHeaders]);

  const loadResourceType = useCallback(async (type: string) => {
    try { const r = await fetch(`${API_BASE}/api/resources?type=${type}`, { headers: authHeaders() }); if (r.ok) { const data = await r.json(); setResourcesByType(p => ({ ...p, [type]: data })); } } catch {}
  }, [authHeaders]);

  const loadAdminUsuarios = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/admin/clientes`, { headers: authHeaders() }); if (r.ok) { const data = await r.json(); setAdminUsuarios(data); } } catch {}
  }, [authHeaders]);

  const loadPaymentHistory = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/api/payments/history`, { headers: authHeaders() }); if (r.ok) { const data = await r.json(); setPayments(data); } } catch {}
  }, [authHeaders]);

  const loadCreditPacks = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/api/payments/packs`, { headers: authHeaders() }); if (r.ok) { const data = await r.json(); setCreditPacks(data); } } catch {}
  }, [authHeaders]);

  const loadAdminStats = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/admin/stats`, { headers: authHeaders() }); if (r.ok) { const data = await r.json(); setAdminStats(data); } } catch {}
  }, [authHeaders]);

  const loadAdminLogs = useCallback(async () => {
    try { const r = await fetch(`${API_BASE}/admin/logs`, { headers: authHeaders() }); if (r.ok) { const data = await r.json(); setAdminLogs(data); } } catch {}
  }, [authHeaders]);

  useEffect(() => {
    if (user?.modeloActivo) setSelectedModel(user.modeloActivo);
    fetch(`${API_BASE}/health`).then(r => setServerStatus(r.ok ? 'online' : 'offline')).catch(() => setServerStatus('offline'));
    loadBilling(); loadAgentes(); loadCreditPacks();
  }, [loadBilling, loadAgentes, loadCreditPacks, user?.modeloActivo]);

  useEffect(() => {
    if (activeTab === 'keys') loadKeys();
    if (activeTab === 'billing') { loadPaymentHistory(); loadCreditPacks(); loadBilling(); }
    if (activeTab === 'admin') { loadAdminUsuarios(); loadAdminStats(); }
    const rt = RESOURCE_TABS.find(t => t.key === activeTab);
    if (rt) loadResourceType(rt.key);
  }, [activeTab, loadKeys, loadAdminUsuarios, loadResourceType, loadPaymentHistory, loadCreditPacks, loadBilling, loadAdminStats]);

  useEffect(() => {
    if (activeTab === 'admin') {
      if (adminTab === 'logs') loadAdminLogs();
      if (adminTab === 'sistema') loadAdminStats();
    }
  }, [adminTab, activeTab, loadAdminLogs, loadAdminStats]);

  const handleCreateAgent = async () => {
    const name = prompt('Nombre del nuevo agente:'); if (!name) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/resources`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ type: 'agente', name }) });
      if (r.ok) { await loadAgentes(); await loadBilling(); }
      else { const e = await r.json(); alert(e.error || 'Error'); }
    } finally { setLoading(false); }
  };

  const handleDeleteResource = async (id: string, type: string) => {
    if (!confirm('¿Eliminar este elemento?')) return;
    const r = await fetch(`${API_BASE}/api/resources/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (r.ok) { if (type === 'agente') loadAgentes(); else loadResourceType(type); loadBilling(); }
  };

  const handleCreateResource = async (type: string, label: string) => {
    const name = prompt(`Nombre para "${label}":`); if (!name) return;
    const r = await fetch(`${API_BASE}/api/resources`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ type, name }) });
    if (r.ok) { loadResourceType(type); loadBilling(); }
    else { const e = await r.json(); alert(e.error || 'Error'); }
  };

  const handleCreateKey = async () => {
    const name = prompt('Nombre para la nueva clave:'); if (!name) return;
    const r = await fetch(`${API_BASE}/api/keys`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) });
    if (r.ok) { const d = await r.json(); alert(`Copia esta clave ahora (no se volverá a mostrar):\n\n${d.key}`); loadKeys(); }
    else { const e = await r.json(); alert(e.error || 'Error'); }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('¿Revocar esta clave? No se puede deshacer.')) return;
    const r = await fetch(`${API_BASE}/api/keys/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (r.ok) loadKeys();
  };

  const handleSelectModel = async (modelo: string) => {
    setSelectedModel(modelo);
    const r = await fetch(`${API_BASE}/api/user/modelo`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ modelo }) });
    if (!r.ok) { const e = await r.json(); alert(e.error || 'Error'); }
  };

  const handleBuyPack = async (packId: string) => {
    setPayingPack(packId);
    try {
      const r = await fetch(`${API_BASE}/api/payments/create`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ packId }) });
      const d = await r.json();
      if (r.ok && d.checkoutUrl) {
        window.open(d.checkoutUrl, '_blank');
      } else {
        alert(d.error || 'Error al crear el pago');
      }
    } finally { setPayingPack(null); }
  };

  const handleAdminTopup = async (userId: string, email: string) => {
    const amountStr = prompt(`Créditos a añadir manualmente a ${email}:`, '10'); if (!amountStr) return;
    const r = await fetch(`${API_BASE}/admin/clientes/${userId}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ creditos: Number(amountStr), _addCredits: true }),
    });
    if (r.ok) { loadAdminUsuarios(); alert('Créditos añadidos'); }
    else { const e = await r.json(); alert(e.error || 'Error'); }
  };

  const handleToggleUser = async (u: AdminUsuario) => {
    const r = await fetch(`${API_BASE}/admin/clientes/${u.id}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ activo: !u.activo }),
    });
    if (r.ok) loadAdminUsuarios();
  };

  const loadAgentMemory = useCallback(async (agentId: string) => {
    setMemoryLoading(true);
    try { const r = await fetch(`${API_BASE}/api/agentes/${agentId}/memoria`, { headers: authHeaders() }); if (r.ok) { const data = await r.json(); setAgentMemory(p => ({ ...p, [agentId]: data })); } } 
    finally { setMemoryLoading(false); }
  }, [authHeaders]);

  const handleToggleMemoria = async (agentId: string) => {
    if (expandedAgentId === agentId) { setExpandedAgentId(null); return; }
    setExpandedAgentId(agentId); await loadAgentMemory(agentId);
  };

  const handleClearMemoria = async (agentId: string) => {
    if (!confirm('¿Borrar toda la memoria de este agente?')) return;
    const r = await fetch(`${API_BASE}/api/agentes/${agentId}/memoria`, { method: 'DELETE', headers: authHeaders() });
    if (r.ok) loadAgentMemory(agentId);
  };

  const balance = billing?.creditos ?? 0;
  const spend = billing?.gastoEsteMes ?? 0;
  const totalRecursos = billing ? Object.values(billing.recursos).reduce((a,b) => a+b, 0) : 0;

  const modelos = [
    { nombre: 'Zoco Fable', backend: 'zoco-fable-5', equiv: 'Máximo rendimiento', tags: ['Más capaz','Investigación'], bg: 'bg-blue-100', icon: 'fa-star' },
    { nombre: 'Zoco Opus', backend: 'zoco-opus-4-8', equiv: 'Alto rendimiento', tags: ['Proyectos complejos','Agentes'], bg: 'bg-orange-100', icon: 'fa-gem' },
    { nombre: 'Zoco Sonnet', backend: 'zoco-sonnet-5', equiv: 'Equilibrado', tags: ['Tareas cotidianas','Rentable'], bg: 'bg-gray-100', icon: 'fa-bolt' },
    { nombre: 'Zoco Haiku', backend: 'zoco-haiku-4-5', equiv: 'Más rápido', tags: ['Alta velocidad','Bajo coste'], bg: 'bg-green-100', icon: 'fa-feather' },
  ];

  const navBtn = (tab: string, icon: string, label: string) => (
    <button key={tab} onClick={() => setActiveTab(tab)}
      className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left ${activeTab === tab ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
      <i className={`fa-solid ${icon} w-4 text-sm`}></i><span>{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-[#fafafa] text-gray-800 font-sans overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col justify-between p-4 z-10 h-full shrink-0 text-[13px] overflow-y-auto">
        <div>
          <div className="flex items-center space-x-2 px-2 py-2 border border-gray-200 rounded-lg bg-gray-50 mb-6">
            <div className="w-5 h-5 bg-black rounded flex items-center justify-center text-white text-[10px] font-bold">Z</div>
            <span className="font-semibold text-gray-700">Zoco IA</span>
            <span className="ml-auto text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">Pro</span>
          </div>
          <nav className="space-y-1">
            {navBtn('panel', 'fa-house', 'Panel de control')}
            {navBtn('keys', 'fa-key', 'Claves de API')}
            {navBtn('billing', 'fa-credit-card', 'Facturación')}
            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Compilar</div>
            {navBtn('archivo', 'fa-folder', 'Archivos')}
            {navBtn('habilidad', 'fa-bolt', 'Habilidades')}
            {navBtn('lote', 'fa-layer-group', 'Lotes')}
            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Agentes</div>
            {navBtn('agentes', 'fa-robot', 'Mis Agentes')}
            {navBtn('sesion', 'fa-comments', 'Sesiones')}
            {navBtn('implementacion', 'fa-rocket', 'Implementaciones')}
            {navBtn('entorno', 'fa-globe', 'Entornos')}
            {navBtn('credencial', 'fa-vault', 'Credenciales')}
            {navBtn('memoria', 'fa-brain', 'Memoria')}
            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Analíticas</div>
            {navBtn('uso', 'fa-chart-simple', 'Uso general')}
            {user?.isAdmin && (
              <>
                <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-red-400 uppercase tracking-wider">Admin</div>
                {navBtn('admin', 'fa-shield-halved', 'Panel Admin')}
              </>
            )}
          </nav>
        </div>
        <div className="border-t border-gray-200 pt-4 space-y-3">
          <div className="flex items-center justify-between p-2 rounded-lg border border-gray-100 bg-gray-50">
            <div>
              <p className="font-bold text-gray-900">{fmtEUR(balance)}</p>
              <p className="text-[11px] text-gray-400">Créditos disponibles</p>
            </div>
            <button onClick={() => setActiveTab('billing')} className="text-[11px] text-blue-600 hover:underline font-medium">
              <i className="fa-solid fa-plus"></i> Recargar
            </button>
          </div>
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center space-x-2 min-w-0">
              <div className="w-7 h-7 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0">
                {(user?.nombre || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 leading-tight truncate">{user?.nombre || 'Usuario'}</p>
                <p className="text-[10px] text-gray-400">{user?.isAdmin ? '👑 Admin' : 'Cliente'} · Zoco IA</p>
              </div>
            </div>
            <button onClick={logout} title="Cerrar sesión" className="text-gray-400 hover:text-red-500 ml-2">
              <i className="fa-solid fa-right-from-bracket"></i>
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 overflow-y-auto p-8 h-full">
        {notification && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 text-[13px] px-4 py-2.5 rounded-lg flex items-center justify-between mb-6">
            <span><i className="fa-solid fa-circle-info mr-2"></i>Backend <strong className={serverStatus === 'online' ? 'text-green-600' : 'text-red-600'}>{serverStatus}</strong> · {agentes.length} agentes activos · Groq IA en línea</span>
            <button onClick={() => setNotification(false)} className="text-gray-400 hover:text-gray-600 font-bold">&times;</button>
          </div>
        )}

        {/* PANEL PRINCIPAL */}
        {activeTab === 'panel' && (
          <>
            <div className="flex justify-between items-center mb-8">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Buenas, {user?.nombre?.split(' ')[0] || 'Maria'} 👋</h1>
                <p className="text-gray-400 text-sm mt-1">Zoco IA Console — Infraestructura privada</p>
              </div>
              <div className="flex items-center space-x-2">
                <button onClick={() => setActiveTab('keys')} className="bg-white border border-gray-300 text-gray-700 px-4 py-1.5 rounded-lg font-medium text-sm shadow-sm hover:bg-gray-50">
                  <i className="fa-solid fa-key mr-1"></i> API Key
                </button>
                <button onClick={handleCreateAgent} disabled={loading} className="bg-black text-white px-4 py-1.5 rounded-lg font-medium text-sm shadow-sm hover:bg-gray-800 disabled:opacity-60">
                  <i className="fa-solid fa-robot mr-1"></i> {loading ? 'Creando...' : 'Nuevo Agente'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
                <div className="text-gray-400 text-sm">Créditos disponibles</div>
                <div className="text-2xl font-bold mt-1">{fmtEUR(balance)}</div>
                <button onClick={() => setActiveTab('billing')} className="text-blue-600 text-xs font-medium hover:underline mt-2 block">Recargar →</button>
              </div>
              <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
                <div className="text-gray-400 text-sm">Gasto este mes</div>
                <div className="text-2xl font-bold mt-1">{fmtEUR(spend)}</div>
                <div className="text-gray-400 text-xs mt-2">actividad real registrada</div>
              </div>
              <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm flex justify-between">
                <div>
                  <div className="text-gray-400 text-sm">Recursos totales</div>
                  <div className="text-2xl font-bold mt-1">{totalRecursos}</div>
                  <div className="text-gray-400 text-xs mt-2">agentes, archivos, etc.</div>
                </div>
                <div className="text-green-600 font-semibold text-xs bg-green-50 px-2 py-1 rounded-md border border-green-100 self-start">
                  {billing?.clavesActivas ?? 0} keys activas
                </div>
              </div>
            </div>

            <h2 className="text-lg font-bold mb-4">Modelos disponibles</h2>
            <div className="grid grid-cols-4 gap-4 mb-8">
              {modelos.map(m => {
                const isSelected = selectedModel === m.backend;
                return (
                  <div key={m.backend} className={`bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col ${isSelected ? 'border-black ring-1 ring-black' : 'border-gray-200'}`}>
                    <div className={`${m.bg} h-16 flex items-center justify-center relative`}>
                      <i className={`fa-solid ${m.icon} text-2xl text-gray-700`}></i>
                      {isSelected && <span className="absolute top-2 right-2 bg-black text-white text-[9px] px-2 py-0.5 rounded-full">✓ Activo</span>}
                    </div>
                    <div className="p-3 flex flex-col flex-1">
                      <p className="font-bold text-sm">{m.nombre}</p>
                      <p className="text-gray-400 text-[11px] mb-2">{m.equiv}</p>
                      <div className="flex flex-wrap gap-1 mb-3">
                        {m.tags.map(t => <span key={t} className="bg-gray-50 text-gray-500 text-[10px] px-1.5 py-0.5 rounded border border-gray-100">{t}</span>)}
                      </div>
                      <button onClick={() => handleSelectModel(m.backend)} disabled={isSelected}
                        className={`w-full py-1.5 rounded-lg text-xs font-medium mt-auto ${isSelected ? 'bg-black text-white' : 'bg-white border border-gray-200 hover:bg-gray-50'}`}>
                        {isSelected ? 'Seleccionado' : 'Seleccionar'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* FACTURACIÓN */}
        {activeTab === 'billing' && (
          <div className="max-w-4xl">
            <h1 className="text-2xl font-bold mb-2">Facturación y créditos</h1>
            <p className="text-gray-400 text-sm mb-6">Recarga tu cuenta para usar los modelos de IA. Los créditos se añaden automáticamente al confirmar el pago.</p>

            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm col-span-1">
                <div className="text-gray-400 text-sm">Saldo actual</div>
                <div className="text-3xl font-bold mt-1 text-green-600">{fmtEUR(balance)}</div>
                <div className="text-gray-400 text-xs mt-2">Gasto este mes: {fmtEUR(spend)}</div>
              </div>
              <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm col-span-2">
                <div className="text-gray-400 text-sm mb-3">Estado de la cuenta</div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Claves activas</span><span className="font-bold">{billing?.clavesActivas ?? 0}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Recursos totales</span><span className="font-bold">{totalRecursos}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Pagos realizados</span><span className="font-bold">{payments.filter(p => p.status === 'completed').length}</span></div>
                </div>
              </div>
            </div>

            <h2 className="text-lg font-bold mb-4">Paquetes de créditos</h2>
            <div className="grid grid-cols-5 gap-3 mb-8">
              {(creditPacks.length > 0 ? creditPacks : [
                { id: 'starter', euros: 5, credits: 5, label: 'Starter' },
                { id: 'basic', euros: 10, credits: 11, label: 'Basic' },
                { id: 'pro', euros: 25, credits: 28, label: 'Pro' },
                { id: 'business', euros: 50, credits: 60, label: 'Business' },
                { id: 'enterprise', euros: 100, credits: 125, label: 'Enterprise' },
              ]).map(pack => (
                <div key={pack.id} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col items-center text-center shadow-sm hover:border-black transition-colors">
                  <p className="font-bold text-gray-900">{pack.label}</p>
                  <p className="text-2xl font-bold mt-2">{pack.euros}€</p>
                  <p className="text-green-600 text-sm font-medium mt-1">{pack.credits} créditos</p>
                  {pack.credits > pack.euros && (
                    <p className="text-[10px] text-blue-600 mt-1">+{pack.credits - pack.euros} bonus</p>
                  )}
                  <button onClick={() => handleBuyPack(pack.id)} disabled={payingPack === pack.id}
                    className="mt-3 w-full bg-black text-white py-1.5 rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-60">
                    {payingPack === pack.id ? 'Redirigiendo...' : 'Comprar'}
                  </button>
                </div>
              ))}
            </div>

            <h2 className="text-lg font-bold mb-4">Historial de pagos</h2>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              {payments.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">Aún no has realizado ningún pago.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Fecha</th>
                      <th className="px-4 py-3 text-left">Importe</th>
                      <th className="px-4 py-3 text-left">Créditos</th>
                      <th className="px-4 py-3 text-left">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {payments.map(p => (
                      <tr key={p.id}>
                        <td className="px-4 py-3 text-gray-500">{fmtDate(p.created_at)}</td>
                        <td className="px-4 py-3 font-medium">{fmtEUR(p.amount)}</td>
                        <td className="px-4 py-3 text-green-600 font-medium">+{p.credits} créditos</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${p.status === 'completed' ? 'bg-green-50 text-green-600 border border-green-100' : p.status === 'pending' ? 'bg-yellow-50 text-yellow-600 border border-yellow-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                            {p.status === 'completed' ? 'Completado' : p.status === 'pending' ? 'Pendiente' : 'Error'}
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

        {/* CLAVES DE API */}
        {activeTab === 'keys' && (
          <div className="max-w-4xl">
            <h1 className="text-2xl font-bold mb-2">Claves de API</h1>
            <p className="text-gray-400 text-sm mb-6">Tus claves secretas para autenticarte en la API de Zoco IA. Guárdalas en un lugar seguro.</p>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="space-y-3 mb-4">
                {keys.length === 0 && <p className="text-gray-400 text-sm">No tienes claves de API todavía.</p>}
                {keys.map(k => (
                  <div key={k.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg bg-gray-50">
                    <div>
                      <p className="font-medium">{k.name}</p>
                      <p className="text-xs text-gray-400">Creada el {fmtDate(k.createdAt)}</p>
                    </div>
                    <div className="flex items-center space-x-3">
                      <code className="bg-white px-2 py-1 rounded border border-gray-200 text-xs">{k.display}</code>
                      <button onClick={() => handleDeleteKey(k.id)} className="text-red-500 hover:underline text-xs font-medium">Revocar</button>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={handleCreateKey} className="bg-black text-white px-4 py-2 rounded-lg font-medium text-sm">
                <i className="fa-solid fa-plus mr-1"></i> Nueva clave secreta
              </button>
            </div>
          </div>
        )}

        {/* AGENTES */}
        {activeTab === 'agentes' && (
          <div className="max-w-4xl">
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold">Agentes de IA</h1>
              <button onClick={handleCreateAgent} className="bg-black text-white px-4 py-2 rounded-lg font-medium text-sm">
                <i className="fa-solid fa-plus mr-1"></i> Nuevo agente
              </button>
            </div>
            {agentes.length === 0 ? (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
                <i className="fa-solid fa-robot text-4xl text-gray-200 mb-4"></i>
                <p className="text-gray-500">No tienes agentes todavía.</p>
                <button onClick={handleCreateAgent} className="mt-4 text-blue-600 font-medium hover:underline">Crear el primero</button>
              </div>
            ) : agentes.map(a => (
              <div key={a.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-3">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600"><i className="fa-solid fa-robot"></i></div>
                    <div>
                      <p className="font-bold">{a.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{a.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="bg-green-50 text-green-600 text-[10px] px-2 py-0.5 rounded-full border border-green-100">Activo</span>
                    <button onClick={() => handleToggleMemoria(a.id)} className="text-gray-500 hover:text-blue-600 text-xs font-medium px-2">
                      <i className="fa-solid fa-brain mr-1"></i>Memoria
                    </button>
                    <button onClick={() => handleDeleteResource(a.id, 'agente')} className="text-gray-400 hover:text-red-500"><i className="fa-solid fa-trash"></i></button>
                  </div>
                </div>
                {expandedAgentId === a.id && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold text-gray-500 uppercase">Memoria persistente</p>
                      <button onClick={() => handleClearMemoria(a.id)} className="text-red-500 hover:underline text-xs">Borrar todo</button>
                    </div>
                    {memoryLoading ? <p className="text-xs text-gray-400">Cargando...</p>
                      : (agentMemory[a.id]?.mensajes || []).length === 0 ? <p className="text-xs text-gray-400">Sin mensajes en memoria todavía.</p>
                      : <div className="space-y-2 max-h-56 overflow-y-auto">
                          {(agentMemory[a.id]?.mensajes || []).map(m => (
                            <div key={m.id} className={`text-xs p-2 rounded-lg ${m.role === 'assistant' ? 'bg-blue-50 text-blue-800' : 'bg-white text-gray-700 border border-gray-100'}`}>
                              <span className="font-semibold uppercase mr-2">{m.role === 'assistant' ? 'Agente' : 'Tú'}</span>{m.content}
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

        {/* RECURSOS GENÉRICOS */}
        {RESOURCE_TABS.map(tab => activeTab === tab.key && (
          <div className="max-w-4xl" key={tab.key}>
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold">{tab.label}</h1>
              <button onClick={() => handleCreateResource(tab.key, tab.label)} className="bg-black text-white px-4 py-2 rounded-lg font-medium text-sm">
                <i className="fa-solid fa-plus mr-1"></i> Nuevo
              </button>
            </div>
            {(resourcesByType[tab.key] || []).length === 0 ? (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
                <i className={`fa-solid ${tab.icon} text-4xl text-gray-200 mb-4`}></i>
                <p className="text-gray-500">No hay elementos en "{tab.label}".</p>
              </div>
            ) : (resourcesByType[tab.key] || []).map(r => (
              <div key={r.id} className="bg-white border border-gray-200 p-4 rounded-xl flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center"><i className={`fa-solid ${tab.icon} text-gray-600`}></i></div>
                  <div>
                    <p className="font-bold">{r.name}</p>
                    <p className="text-xs text-gray-400">{fmtDate(r.createdAt)}</p>
                  </div>
                </div>
                <button onClick={() => handleDeleteResource(r.id, tab.key)} className="text-gray-400 hover:text-red-500"><i className="fa-solid fa-trash"></i></button>
              </div>
            ))}
          </div>
        ))}

        {/* USO */}
        {activeTab === 'uso' && (
          <div className="max-w-4xl">
            <h1 className="text-2xl font-bold mb-6">Uso general</h1>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-3">
              <div className="flex justify-between text-sm border-b pb-3"><span className="text-gray-500">Créditos disponibles</span><span className="font-bold">{fmtEUR(balance)}</span></div>
              <div className="flex justify-between text-sm border-b pb-3"><span className="text-gray-500">Gasto este mes</span><span className="font-bold">{fmtEUR(spend)}</span></div>
              <div className="flex justify-between text-sm border-b pb-3"><span className="text-gray-500">Claves activas</span><span className="font-bold">{billing?.clavesActivas ?? 0}</span></div>
              {billing && Object.entries(billing.recursos).map(([tipo, count]) => (
                <div key={tipo} className="flex justify-between text-sm"><span className="text-gray-500 capitalize">{tipo}</span><span className="font-bold">{count}</span></div>
              ))}
            </div>
          </div>
        )}

        {/* ADMIN */}
        {activeTab === 'admin' && user?.isAdmin && (
          <div className="max-w-6xl">
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center"><i className="fa-solid fa-shield-halved text-red-600"></i></div>
              <div>
                <h1 className="text-2xl font-bold">Panel de Administración</h1>
                <p className="text-gray-400 text-sm">Control total de la plataforma Zoco IA</p>
              </div>
            </div>

            {/* Stats rápidas admin */}
            {adminStats && (
              <div className="grid grid-cols-4 gap-4 mb-6">
                {[
                  { label: 'Usuarios totales', value: adminStats.totalUsuarios, icon: 'fa-users', color: 'blue' },
                  { label: 'Ingresos totales', value: fmtEUR(adminStats.ingresosTotal || 0), icon: 'fa-euro-sign', color: 'green' },
                  { label: 'Llamadas IA hoy', value: adminStats.llamadasHoy || 0, icon: 'fa-robot', color: 'purple' },
                  { label: 'Usuarios activos', value: adminStats.usuariosActivos || 0, icon: 'fa-circle-check', color: 'orange' },
                ].map(s => (
                  <div key={s.label} className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm">
                    <div className="text-gray-400 text-xs">{s.label}</div>
                    <div className="text-xl font-bold mt-1">{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Tabs admin */}
            <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg mb-6 w-fit">
              {(['usuarios','pagos','sistema','logs'] as const).map(t => (
                <button key={t} onClick={() => setAdminTab(t)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize ${adminTab === t ? 'bg-white shadow-sm text-black' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t === 'usuarios' ? '👥 Usuarios' : t === 'pagos' ? '💳 Pagos' : t === 'sistema' ? '⚙️ Sistema' : '📋 Logs'}
                </button>
              ))}
            </div>

            {/* Tab: Usuarios */}
            {adminTab === 'usuarios' && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 text-xs">
                    <tr>
                      <th className="px-4 py-3 text-left">Usuario</th>
                      <th className="px-4 py-3 text-left">Email</th>
                      <th className="px-4 py-3 text-left">Rol</th>
                      <th className="px-4 py-3 text-left">Créditos</th>
                      <th className="px-4 py-3 text-left">Estado</th>
                      <th className="px-4 py-3 text-left">Registro</th>
                      <th className="px-4 py-3 text-left">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {adminUsuarios.map(u => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{u.nombre}</td>
                        <td className="px-4 py-3 text-gray-500">{u.email}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] border font-medium ${u.isAdmin ? 'bg-red-50 text-red-600 border-red-100' : u.isSupport ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                            {u.isAdmin ? '👑 Admin' : u.isSupport ? '🛠 Soporte' : 'Cliente'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold text-green-600">{fmtEUR(u.creditos)}</td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center space-x-1 text-xs font-medium ${u.activo ? 'text-green-600' : 'text-red-500'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${u.activo ? 'bg-green-500' : 'bg-red-500'}`}></span>
                            <span>{u.activo ? 'Activo' : 'Inactivo'}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(u.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <button onClick={() => handleAdminTopup(u.id, u.email)} className="text-green-600 hover:underline text-xs font-medium">+Créditos</button>
                            <button onClick={() => handleToggleUser(u)} className={`text-xs font-medium hover:underline ${u.activo ? 'text-red-500' : 'text-green-600'}`}>
                              {u.activo ? 'Desactivar' : 'Activar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tab: Pagos */}
            {adminTab === 'pagos' && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-xs font-bold text-gray-500 uppercase">Todos los pagos de la plataforma</div>
                {adminStats?.ultimosPagos?.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">No hay pagos registrados todavía.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b text-gray-500 text-xs">
                      <tr>
                        <th className="px-4 py-3 text-left">Fecha</th>
                        <th className="px-4 py-3 text-left">Usuario</th>
                        <th className="px-4 py-3 text-left">Importe</th>
                        <th className="px-4 py-3 text-left">Créditos</th>
                        <th className="px-4 py-3 text-left">Estado</th>
                        <th className="px-4 py-3 text-left">Proveedor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(adminStats?.ultimosPagos || []).map((p: any) => (
                        <tr key={p.id}>
                          <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(p.created_at)}</td>
                          <td className="px-4 py-3 text-gray-600">{p.user_email || p.user_id?.slice(0,8)}</td>
                          <td className="px-4 py-3 font-bold">{fmtEUR(p.amount)}</td>
                          <td className="px-4 py-3 text-green-600">+{p.credits}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${p.status === 'completed' ? 'bg-green-50 text-green-600 border border-green-100' : 'bg-yellow-50 text-yellow-600 border border-yellow-100'}`}>
                              {p.status === 'completed' ? '✓ Completado' : '⏳ Pendiente'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400 capitalize">{p.provider}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Tab: Sistema */}
            {adminTab === 'sistema' && (
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                  <h3 className="font-bold mb-4">⚙️ Configuración del sistema</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Backend</span><span className="font-medium text-green-600">● Online</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Motor IA</span><span className="font-medium">{adminStats?.ollamaOnline ? '🖥 Ollama local' : '☁️ Groq Cloud'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Base de datos</span><span className="font-medium">SQLite + Volumen</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Pasarela de pago</span><span className="font-medium">{adminStats?.vivaConfigurado ? '✓ Viva.com' : '⚠️ No configurada'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Usuarios registrados</span><span className="font-bold">{adminStats?.totalUsuarios || 0}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Ingresos totales</span><span className="font-bold text-green-600">{fmtEUR(adminStats?.ingresosTotal || 0)}</span></div>
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                  <h3 className="font-bold mb-4">🔑 Variables de entorno necesarias</h3>
                  <div className="space-y-2 text-xs font-mono">
                    {[
                      ['GROQ_API_KEY', 'Motor IA cloud'],
                      ['OLLAMA_URL', 'Ollama local (Ngrok)'],
                      ['VIVA_CLIENT_ID', 'Pagos Viva.com'],
                      ['VIVA_CLIENT_SECRET', 'Pagos Viva.com'],
                      ['VIVA_SOURCE_CODE', 'Pagos Viva.com'],
                      ['VIVA_WEBHOOK_KEY', 'Webhook verificación'],
                      ['JWT_SECRET', '✓ Configurado'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between p-2 bg-gray-50 rounded">
                        <span className="text-gray-700">{k}</span>
                        <span className="text-gray-400">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Logs */}
            {adminTab === 'logs' && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b bg-gray-50 flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-500 uppercase">Últimas 100 transacciones</span>
                  <button onClick={loadAdminLogs} className="text-xs text-blue-600 hover:underline">Actualizar</button>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  {adminLogs.length === 0 ? <p className="p-6 text-center text-gray-400 text-sm">No hay logs todavía.</p> : (
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b text-gray-400 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 text-left">Fecha</th>
                          <th className="px-4 py-2 text-left">Usuario</th>
                          <th className="px-4 py-2 text-left">Tipo</th>
                          <th className="px-4 py-2 text-left">Importe</th>
                          <th className="px-4 py-2 text-left">Descripción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {adminLogs.map((l: any) => (
                          <tr key={l.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-400">{fmtDate(l.created_at)}</td>
                            <td className="px-4 py-2 text-gray-500">{l.user_id?.slice(0,8)}...</td>
                            <td className="px-4 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${l.kind === 'gasto' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                                {l.kind === 'gasto' ? '↓ Gasto' : '↑ Recarga'}
                              </span>
                            </td>
                            <td className="px-4 py-2 font-medium">{l.kind === 'gasto' ? '-' : '+'}{Math.abs(l.amount).toFixed(4)} €</td>
                            <td className="px-4 py-2 text-gray-400">{l.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
