import React, { useState, useEffect, useCallback } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

interface Recurso {
  id: string;
  type: string;
  name: string;
  data: Record<string, any>;
  createdAt: string;
}

interface ApiKey {
  id: string;
  name: string;
  display: string;
  revoked: boolean;
  createdAt: string;
}

interface AdminUsuario {
  id: string;
  email: string;
  nombre: string;
  isAdmin: boolean;
  isSupport: boolean;
  creditos: number;
  activo: boolean;
  createdAt: string;
}

interface BillingSummary {
  creditos: number;
  gastoEsteMes: number;
  recursos: Record<string, number>;
  clavesActivas: number;
}

interface MemoriaMensaje {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

const RESOURCE_TABS: { key: string; label: string; icon: string }[] = [
  { key: 'archivo', label: 'Archivos', icon: 'fa-folder' },
  { key: 'habilidad', label: 'Habilidades', icon: 'fa-bolt' },
  { key: 'lote', label: 'Lotes', icon: 'fa-layer-group' },
  { key: 'sesion', label: 'Sesiones', icon: 'fa-comments' },
  { key: 'implementacion', label: 'Implementaciones', icon: 'fa-rocket' },
  { key: 'entorno', label: 'Entornos', icon: 'fa-globe' },
  { key: 'credencial', label: 'Almacenes de credenciales', icon: 'fa-vault' },
  { key: 'memoria', label: 'Almacenes de memoria', icon: 'fa-brain' },
];

function fmtEUR(n: number) {
  return `${(n || 0).toFixed(2)} €`;
}

export default function Dashboard() {
  const { user, token, logout } = useAuth();

  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [agentes, setAgentes] = useState<Recurso[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [resourcesByType, setResourcesByType] = useState<Record<string, Recurso[]>>({});
  const [adminUsuarios, setAdminUsuarios] = useState<AdminUsuario[]>([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(true);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState('panel');
  const [selectedModel, setSelectedModel] = useState<string>('maris-core-7b');
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [agentMemory, setAgentMemory] = useState<Record<string, { mensajes: MemoriaMensaje[]; cacheActiva: boolean }>>({});
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [modeloDetalle, setModeloDetalle] = useState<{ nombre: string; modelId: string; descripcion: string; backend: string; coste: any; funciones: any } | null>(null);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const loadBilling = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/summary`, { headers: authHeaders() });
      if (res.ok) setBilling(await res.json());
    } catch (err) {
      console.error('Error cargando facturación:', err);
    }
  }, [authHeaders]);

  const loadAgentes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/resources?type=agente`, { headers: authHeaders() });
      if (res.ok) setAgentes(await res.json());
    } catch (err) {
      console.error('Error cargando agentes:', err);
    }
  }, [authHeaders]);

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/keys`, { headers: authHeaders() });
      if (res.ok) setKeys(await res.json());
    } catch (err) {
      console.error('Error cargando claves:', err);
    }
  }, [authHeaders]);

  const loadResourceType = useCallback(async (type: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/resources?type=${type}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setResourcesByType((prev) => ({ ...prev, [type]: data }));
      }
    } catch (err) {
      console.error(`Error cargando ${type}:`, err);
    }
  }, [authHeaders]);

  const loadAdminUsuarios = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/clientes`, { headers: authHeaders() });
      if (res.ok) setAdminUsuarios(await res.json());
    } catch (err) {
      console.error('Error cargando usuarios:', err);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (user?.modeloActivo) setSelectedModel(user.modeloActivo);
  }, [user?.modeloActivo]);

  useEffect(() => {
    async function fetchServerStatus() {
      try {
        const res = await fetch(`${API_BASE}/health`);
        setServerStatus(res.ok ? 'online' : 'offline');
      } catch (err) {
        setServerStatus('offline');
      }
    }
    fetchServerStatus();
    loadBilling();
    loadAgentes();

    fetch(`${API_BASE}/api/system/ollama`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { online: false }))
      .then((d) => setOllamaOnline(!!d.online))
      .catch(() => setOllamaOnline(false));
  }, [loadBilling, loadAgentes, authHeaders]);

  useEffect(() => {
    if (activeTab === 'keys') loadKeys();
    if (activeTab === 'admin') loadAdminUsuarios();
    const resourceTab = RESOURCE_TABS.find((t) => t.key === activeTab);
    if (resourceTab) loadResourceType(resourceTab.key);
  }, [activeTab, loadKeys, loadAdminUsuarios, loadResourceType]);

  const handleCreateAgent = async () => {
    const name = prompt('Introduce el nombre de tu nuevo agente de software:');
    if (!name) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/resources`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ type: 'agente', name }),
      });
      if (response.ok) {
        await loadAgentes();
        await loadBilling();
        alert('Agente creado con éxito');
      } else {
        const errData = await response.json();
        alert(`Error: ${errData.error || 'No se pudo crear el agente'}`);
      }
    } catch (err) {
      console.error('Error creando agente:', err);
      alert('Error de conexión al crear el agente');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteResource = async (id: string, type: string) => {
    if (!confirm('¿Seguro que quieres eliminar este elemento?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/resources/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) {
        if (type === 'agente') await loadAgentes();
        else await loadResourceType(type);
        await loadBilling();
      }
    } catch (err) {
      console.error('Error eliminando recurso:', err);
    }
  };

  const handleCreateResource = async (type: string, label: string) => {
    const name = prompt(`Nombre para el nuevo elemento en "${label}":`);
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE}/api/resources`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ type, name }),
      });
      if (res.ok) {
        await loadResourceType(type);
        await loadBilling();
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.error || 'No se pudo crear'}`);
      }
    } catch (err) {
      console.error('Error creando recurso:', err);
    }
  };

  const handleCreateKey = async () => {
    const name = prompt('Nombre para la nueva clave de API:');
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE}/api/keys`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Clave creada. Cópiala ahora, no se volverá a mostrar:\n\n${data.key}`);
        await loadKeys();
        await loadBilling();
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.error || 'No se pudo crear la clave'}`);
      }
    } catch (err) {
      console.error('Error creando clave:', err);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('¿Revocar esta clave de API? No se podrá deshacer.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/keys/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) {
        await loadKeys();
        await loadBilling();
      }
    } catch (err) {
      console.error('Error eliminando clave:', err);
    }
  };

  const handleTopup = async () => {
    const amountStr = prompt('¿Cuántos créditos (€) quieres añadir?', '100');
    if (!amountStr) return;
    const amount = Number(amountStr);
    if (!amount || amount <= 0) return alert('Introduce un importe válido');
    try {
      const res = await fetch(`${API_BASE}/api/billing/topup`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ amount }),
      });
      if (res.ok) await loadBilling();
    } catch (err) {
      console.error('Error añadiendo créditos:', err);
    }
  };

  const handleSelectModel = async (modelo: string) => {
    setSelectedModel(modelo);
    try {
      const res = await fetch(`${API_BASE}/api/user/modelo`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ modelo }),
      });
      if (!res.ok) {
        const errData = await res.json();
        alert(`Error: ${errData.error || 'No se pudo seleccionar el modelo'}`);
      }
    } catch (err) {
      console.error('Error seleccionando modelo:', err);
    }
  };

  const loadAgentMemory = useCallback(async (agentId: string) => {
    setMemoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/agentes/${agentId}/memoria`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAgentMemory((prev) => ({ ...prev, [agentId]: data }));
      }
    } catch (err) {
      console.error('Error cargando memoria del agente:', err);
    } finally {
      setMemoryLoading(false);
    }
  }, [authHeaders]);

  const handleToggleMemoria = async (agentId: string) => {
    if (expandedAgentId === agentId) {
      setExpandedAgentId(null);
      return;
    }
    setExpandedAgentId(agentId);
    await loadAgentMemory(agentId);
  };

  const handleAddMemoria = async (agentId: string) => {
    const content = prompt('Añade un mensaje a la memoria persistente de este agente:');
    if (!content) return;
    try {
      const res = await fetch(`${API_BASE}/api/agentes/${agentId}/memoria`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ role: 'user', content }),
      });
      if (res.ok) await loadAgentMemory(agentId);
    } catch (err) {
      console.error('Error añadiendo memoria:', err);
    }
  };

  const handleClearMemoria = async (agentId: string) => {
    if (!confirm('¿Borrar toda la memoria persistente y la caché de este agente? No se puede deshacer.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/agentes/${agentId}/memoria`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) await loadAgentMemory(agentId);
    } catch (err) {
      console.error('Error borrando memoria:', err);
    }
  };

  const handleEditUsuario = async (u: AdminUsuario) => {
    const nuevosCreditos = prompt(`Créditos para ${u.email}:`, String(u.creditos));
    if (nuevosCreditos === null) return;
    const nuevoActivo = confirm(`¿Debe estar ACTIVA la cuenta de ${u.email}? Aceptar = Sí, Cancelar = No (desactivar)`);
    try {
      const res = await fetch(`${API_BASE}/admin/clientes/${u.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ creditos: Number(nuevosCreditos), activo: nuevoActivo }),
      });
      if (res.ok) {
        await loadAdminUsuarios();
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.error || 'No se pudo actualizar'}`);
      }
    } catch (err) {
      console.error('Error editando usuario:', err);
    }
  };

  const balance = billing?.creditos ?? 0;
  const spend = billing?.gastoEsteMes ?? 0;
  const totalRecursos = billing ? Object.values(billing.recursos).reduce((a, b) => a + b, 0) : 0;

  const modelos = [
    {
      nombre: 'Zoco Fable', badge: 'Nuevo', backend: 'maris-beta-70b', modelId: 'zoco-fable-5',
      descripcion: 'Modelo insignia para los problemas más complejos.',
      equiv: 'Equiv. Fable 5', tags: ['Más capaz', 'Investigación', 'Tareas de varios días'], bg: 'bg-blue-100',
      coste: { entrada: 10, salida: 50, cacheEscribir: 12.5, cacheLeer: 1, modoRapidoEntrada: null, modoRapidoSalida: null },
      funciones: { contexto: '1 M tok', salidaMaxima: '128 mil tok', velocidad: 1, modoRapido: false, pensamientoAdaptativo: true, corteConocimiento: 'ene 2026' },
    },
    {
      nombre: 'Zoco Opus', badge: null, backend: 'maris-pro-32b', modelId: 'zoco-opus-4-8',
      descripcion: 'Modelo potente para trabajos complejos.',
      equiv: 'Equiv. Opus 4.8', tags: ['Proyectos complejos', 'Agentes', 'Programación'], bg: 'bg-orange-100',
      coste: { entrada: 5, salida: 25, cacheEscribir: 6.25, cacheLeer: 0.5, modoRapidoEntrada: 10, modoRapidoSalida: 50 },
      funciones: { contexto: '1 M tok', salidaMaxima: '128 mil tok', velocidad: 1, modoRapido: true, pensamientoAdaptativo: true, corteConocimiento: 'ene 2026' },
    },
    {
      nombre: 'Zoco Sonnet', badge: 'Nuevo', backend: 'maris-core-7b', modelId: 'zoco-sonnet-5',
      descripcion: 'Velocidad, coste e inteligencia equilibrados.',
      equiv: 'Equiv. Sonnet 5', tags: ['Tareas cotidianas', 'Escritura', 'Rentable'], bg: 'bg-gray-100',
      coste: { entrada: 2, salida: 10, cacheEscribir: 2.5, cacheLeer: 0.2, modoRapidoEntrada: null, modoRapidoSalida: null },
      funciones: { contexto: '1 M tok', salidaMaxima: '128 mil tok', velocidad: 2, modoRapido: false, pensamientoAdaptativo: true, corteConocimiento: 'ene 2026' },
    },
    {
      nombre: 'Zoco Haiku', badge: null, backend: 'maris-velox-1b', modelId: 'zoco-haiku-4-5',
      descripcion: 'Inteligencia rápida y casi de vanguardia al menor coste.',
      equiv: 'Equiv. Haiku 4.5', tags: ['Más rápido', 'Menor coste', 'Alto volumen'], bg: 'bg-green-100',
      coste: { entrada: 1, salida: 5, cacheEscribir: 1.25, cacheLeer: 0.1, modoRapidoEntrada: null, modoRapidoSalida: null },
      funciones: { contexto: '200 mil tok', salidaMaxima: '64 mil tok', velocidad: 3, modoRapido: false, pensamientoAdaptativo: false, corteConocimiento: 'feb 2025' },
    },
  ];

  const recursosDestacados = [
    { icono: 'fa-wand-magic-sparkles', titulo: 'Herramienta de habilidades', badge: 'Beta', texto: 'Aumenta la inteligencia minimizando el coste y el uso de tokens. Un modelo más económico.' },
    { icono: 'fa-bolt', titulo: 'Modo rápido', badge: null, texto: 'Hasta 2,5 veces más rápido en los modelos compatibles, con precios premium. El mismo modelo, la misma inteligencia.' },
    { icono: 'fa-layer-group', titulo: 'Batch API', badge: null, texto: 'Mueve las cargas de trabajo asíncronas a la Batch API y ahorra un 50% en los precios estándar de la API.' },
    { icono: 'fa-database', titulo: 'Caché de prompts', badge: null, texto: 'Reutiliza prefijos de prompt en las llamadas a la API. La mayoría de organizaciones reducen sus costes de entrada entre un 50-90%.' },
  ];

  return (
    <div className="flex h-screen bg-[#fafafa] text-gray-800 antialiased font-sans w-full overflow-hidden">
      {/* BARRA LATERAL */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col justify-between p-4 z-10 h-full shrink-0 text-[13px] overflow-y-auto">
        <div>
          <div className="flex items-center justify-between px-2 py-2 border border-gray-200 rounded-lg bg-gray-50 mb-6 cursor-pointer">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 bg-black rounded flex items-center justify-center text-white text-[10px] font-bold">Z</div>
              <span className="font-semibold text-gray-700">Zoco IA</span>
            </div>
            <i className="fa-solid fa-chevron-down text-gray-400 text-[10px]"></i>
          </div>
          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab('panel')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'panel' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-house text-gray-600 w-4"></i><span>Panel de control</span>
            </button>
            <button
              onClick={() => setActiveTab('keys')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'keys' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-key w-4"></i><span>Claves de API</span>
            </button>

            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Compilar</div>
            <button
              onClick={() => setActiveTab('archivo')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg ${activeTab === 'archivo' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <div className="flex items-center space-x-3"><i className="fa-solid fa-folder w-4"></i><span>Archivos</span></div>
            </button>
            <button
              onClick={() => setActiveTab('habilidad')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'habilidad' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-bolt w-4"></i><span>Habilidades</span>
            </button>
            <button
              onClick={() => setActiveTab('lote')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'lote' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-layer-group w-4"></i><span>Lotes</span>
            </button>

            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>Agentes gestionados</span><i className="fa-solid fa-chevron-down text-[9px]"></i>
            </div>
            <button
              onClick={() => setActiveTab('agentes')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'agentes' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-robot w-4"></i><span>Agentes</span>
            </button>
            <button
              onClick={() => setActiveTab('sesion')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'sesion' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-comments w-4"></i><span>Sesiones</span>
            </button>
            <button
              onClick={() => setActiveTab('implementacion')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'implementacion' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-rocket w-4"></i><span>Implementaciones</span>
            </button>
            <button
              onClick={() => setActiveTab('entorno')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'entorno' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-globe w-4"></i><span>Entornos</span>
            </button>
            <button
              onClick={() => setActiveTab('credencial')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'credencial' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-vault w-4"></i><span>Almacenes de credenciales</span>
            </button>
            <button
              onClick={() => setActiveTab('memoria')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'memoria' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-brain w-4"></i><span>Almacenes de memoria</span>
            </button>

            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>Analíticas</span><i className="fa-solid fa-chevron-right text-[9px]"></i>
            </div>
            <button
              onClick={() => setActiveTab('uso')}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'uso' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <i className="fa-solid fa-chart-simple w-4"></i><span>Uso general</span>
            </button>

            {user?.isAdmin && (
              <div className="pt-2">
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg ${activeTab === 'admin' ? 'bg-gray-100 text-black font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <i className="fa-solid fa-shield w-4"></i><span>Administración</span>
                </button>
              </div>
            )}
          </nav>
        </div>

        <div className="border-t border-gray-200 pt-4 space-y-3">
          <button className="flex items-center space-x-2 px-2 text-gray-500 hover:text-gray-700">
            <i className="fa-solid fa-book w-4"></i><span>Documentación</span>
          </button>
          <div className="flex items-center justify-between p-2 rounded-lg border border-gray-100 bg-gray-50">
            <div>
              <p className="font-bold text-gray-900">{fmtEUR(balance)}</p>
              <p className="text-[11px] text-gray-400">Fondos disponibles</p>
            </div>
            <button onClick={handleTopup} className="text-[11px] text-blue-600 hover:underline font-medium">
              <i className="fa-solid fa-plus"></i> Añadir
            </button>
          </div>
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center space-x-2 min-w-0">
              <div className="w-7 h-7 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0">
                {(user?.nombre || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 leading-tight truncate">{user?.nombre || 'Usuario'}</p>
                <p className="text-[10px] text-gray-400 truncate">
                  {user?.isAdmin ? 'Admin' : user?.isSupport ? 'Soporte' : 'Cliente'} · Zoco IA
                </p>
              </div>
            </div>
            <button onClick={logout} title="Cerrar sesión" className="text-gray-400 hover:text-red-500 shrink-0 ml-2">
              <i className="fa-solid fa-right-from-bracket"></i>
            </button>
          </div>
        </div>
      </aside>

      {/* ÁREA CENTRAL */}
      <main className="flex-1 overflow-y-auto bg-[#fafafa] p-8 h-full">
        {notification && (
          <div className="bg-[#edf5fd] border border-[#d4e8fc] text-[#1d6cd3] text-[13px] px-4 py-2.5 rounded-lg flex items-center justify-between mb-8 shadow-sm">
            <div className="flex items-center space-x-2">
              <i className="fa-solid fa-circle-info"></i>
              <span>El acceso a tus <strong>{agentes.length} agentes de software</strong> está activo. Estado de Ollama: <strong>{ollamaOnline === null ? 'comprobando…' : ollamaOnline ? 'en línea' : 'sin conexión'}</strong>.</span>
            </div>
            <button onClick={() => setNotification(false)} className="text-gray-400 hover:text-gray-600 text-lg font-bold leading-none">&times;</button>
          </div>
        )}

        {activeTab === 'panel' && (
          <>
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Buenas tardes, {user?.nombre?.split(' ')[0] || 'Maria'}</h1>
              <div className="flex items-center space-x-2 text-[13px]">
                <span
                  title={serverStatus === 'online' ? 'Backend conectado' : 'Backend no disponible'}
                  className={`w-2 h-2 rounded-full ${serverStatus === 'online' ? 'bg-green-500' : serverStatus === 'offline' ? 'bg-red-500' : 'bg-gray-300'}`}
                ></span>
                <button onClick={() => setActiveTab('keys')} className="bg-white border border-gray-300 text-gray-700 px-4 py-1.5 rounded-lg font-medium shadow-sm hover:bg-gray-50">
                  <i className="fa-solid fa-key mr-1"></i> Obtener clave de API
                </button>
                <button onClick={handleCreateAgent} disabled={loading} className="bg-black text-white px-4 py-1.5 rounded-lg font-medium shadow-sm hover:bg-gray-800 disabled:opacity-60">
                  <i className="fa-solid fa-robot mr-1"></i> {loading ? 'Procesando...' : 'Crear un agente'}
                </button>
              </div>
            </div>

            {/* MÉTRICAS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-[13px]">
              <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm relative">
                <div className="text-gray-400 font-medium">Créditos de la organización</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{fmtEUR(balance)}</div>
                <button onClick={handleTopup} className="text-red-500 text-[11px] font-medium hover:underline mt-2 block">Añadir créditos</button>
              </div>
              <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
                <div className="flex justify-between items-start">
                  <div className="text-gray-400 font-medium">Gasto este mes</div>
                </div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{fmtEUR(spend)}</div>
                <div className="text-gray-400 text-[11px] mt-2">calculado a partir de tu actividad real</div>
              </div>
              <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm flex justify-between items-start">
                <div>
                  <div className="text-gray-400 font-medium">Recursos totales</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{totalRecursos}</div>
                  <div className="text-gray-400 text-[11px] mt-2">agentes, archivos, habilidades, etc.</div>
                </div>
                <div className="text-green-600 font-semibold text-[11px] bg-green-50 px-2 py-1 rounded-md border border-green-100">{billing?.clavesActivas ?? 0} claves activas</div>
              </div>
            </div>

            {/* MODELOS */}
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-900">Modelos</h2>
              <button className="text-[13px] text-gray-500 hover:underline">Comparar modelos</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 text-[12px]">
              {modelos.map((m) => {
                const isSelected = selectedModel === m.backend;
                return (
                  <div
                    key={m.nombre}
                    onClick={() => setModeloDetalle(m)}
                    className={`bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col cursor-pointer hover:shadow-md transition-shadow ${isSelected ? 'border-black ring-1 ring-black' : 'border-gray-200'}`}
                  >
                    <div className={`${m.bg} h-20 flex items-center justify-center relative`}>
                      <i className="fa-solid fa-robot text-2xl text-gray-700"></i>
                      {isSelected && (
                        <span className="absolute top-2 right-2 bg-black text-white text-[9px] px-2 py-0.5 rounded-full font-medium">
                          <i className="fa-solid fa-check mr-1"></i>Activo
                        </span>
                      )}
                    </div>
                    <div className="p-4 flex flex-col justify-between flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-sm text-gray-900">{m.nombre}</span>
                        {m.badge && <span className="bg-blue-50 text-blue-600 text-[10px] px-2 py-0.5 rounded-full font-medium border border-blue-100">{m.badge}</span>}
                      </div>
                      <p className="text-gray-400 text-[11px] mb-3">{m.equiv}</p>
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {m.tags.map(t => <span key={t} className="bg-gray-50 text-gray-500 px-2 py-0.5 rounded-md border border-gray-100">{t}</span>)}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSelectModel(m.backend); }}
                        disabled={isSelected}
                        className={`w-full py-2 rounded-lg font-medium transition-colors ${isSelected ? 'bg-gray-900 text-white cursor-default' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                      >
                        {isSelected ? 'Seleccionado' : 'Seleccionar'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* RECURSOS DESTACADOS */}
            <h2 className="text-lg font-bold text-gray-900 mb-4">Recursos</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-[12px]">
              {recursosDestacados.map((r) => (
                <div key={r.titulo} className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm flex flex-col">
                  <div className="flex items-center space-x-2 mb-2">
                    <i className={`fa-solid ${r.icono} text-gray-700`}></i>
                    <span className="font-bold text-gray-900">{r.titulo}</span>
                    {r.badge && <span className="bg-blue-50 text-blue-600 text-[9px] px-1.5 py-0.5 rounded-full font-medium border border-blue-100">{r.badge}</span>}
                  </div>
                  <p className="text-gray-500 leading-relaxed flex-1">{r.texto}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === 'keys' && (
          <div className="max-w-4xl">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Claves de API</h1>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <p className="text-gray-600 mb-4">Tus claves de API secretas te permiten autenticarte en las solicitudes a Zoco IA.</p>
              <div className="space-y-4">
                {keys.length === 0 && (
                  <p className="text-gray-400 text-sm">Aún no tienes claves de API.</p>
                )}
                {keys.map((k) => (
                  <div key={k.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg bg-gray-50">
                    <div>
                      <p className="font-medium text-gray-900">{k.name}</p>
                      <p className="text-xs text-gray-400">Creada el {new Date(k.createdAt).toLocaleDateString('es-ES')}</p>
                    </div>
                    <div className="flex items-center space-x-3">
                      <code className="bg-white px-2 py-1 rounded border border-gray-200 text-xs">{k.display}</code>
                      <button onClick={() => handleDeleteKey(k.id)} className="text-red-500 hover:underline text-xs font-medium">Revocar</button>
                    </div>
                  </div>
                ))}
                <button onClick={handleCreateKey} className="bg-black text-white px-4 py-2 rounded-lg font-medium text-sm">Crear nueva clave secreta</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'agentes' && (
          <div className="max-w-4xl">
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Agentes Gestionados</h1>
              <button onClick={handleCreateAgent} className="bg-black text-white px-4 py-2 rounded-lg font-medium text-sm">
                <i className="fa-solid fa-plus mr-1"></i> Nuevo agente
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {agentes.length === 0 ? (
                <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
                  <i className="fa-solid fa-robot text-4xl text-gray-200 mb-4"></i>
                  <p className="text-gray-500">No tienes agentes personalizados todavía.</p>
                  <button onClick={handleCreateAgent} className="mt-4 text-blue-600 font-medium hover:underline">Crear tu primer agente</button>
                </div>
              ) : (
                agentes.map(a => (
                  <div key={a.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                          <i className="fa-solid fa-robot"></i>
                        </div>
                        <div>
                          <p className="font-bold text-gray-900">{a.name}</p>
                          <p className="text-xs text-gray-400">ID: {a.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="bg-green-50 text-green-600 text-[10px] px-2 py-0.5 rounded-full border border-green-100">Activo</span>
                        {agentMemory[a.id]?.cacheActiva && (
                          <span className="bg-purple-50 text-purple-600 text-[10px] px-2 py-0.5 rounded-full border border-purple-100">
                            <i className="fa-solid fa-database mr-1"></i>Caché activa
                          </span>
                        )}
                        <button onClick={() => handleToggleMemoria(a.id)} className="text-gray-400 hover:text-blue-600 text-xs font-medium px-2">
                          <i className="fa-solid fa-brain mr-1"></i>Memoria
                        </button>
                        <button onClick={() => handleDeleteResource(a.id, 'agente')} className="text-gray-400 hover:text-red-500"><i className="fa-solid fa-trash"></i></button>
                      </div>
                    </div>

                    {expandedAgentId === a.id && (
                      <div className="border-t border-gray-100 bg-gray-50 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Memoria persistente del agente</p>
                          <div className="space-x-3">
                            <button onClick={() => handleAddMemoria(a.id)} className="text-blue-600 hover:underline text-xs font-medium">Añadir mensaje</button>
                            <button onClick={() => handleClearMemoria(a.id)} className="text-red-500 hover:underline text-xs font-medium">Borrar memoria y caché</button>
                          </div>
                        </div>
                        {memoryLoading ? (
                          <p className="text-xs text-gray-400">Cargando...</p>
                        ) : (agentMemory[a.id]?.mensajes || []).length === 0 ? (
                          <p className="text-xs text-gray-400">Este agente todavía no tiene memoria guardada. Los mensajes que envíe o reciba se persistirán aquí y se reutilizarán como contexto en cachés futuras, igual que la caché de prompts de Anthropic.</p>
                        ) : (
                          <div className="space-y-2 max-h-56 overflow-y-auto">
                            {(agentMemory[a.id]?.mensajes || []).map((m) => (
                              <div key={m.id} className={`text-xs p-2 rounded-lg ${m.role === 'assistant' ? 'bg-blue-50 text-blue-800' : 'bg-white text-gray-700 border border-gray-100'}`}>
                                <span className="font-semibold uppercase mr-2">{m.role === 'assistant' ? 'Agente' : 'Usuario'}</span>{m.content}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {RESOURCE_TABS.map((tab) => activeTab === tab.key && (
          <div className="max-w-4xl" key={tab.key}>
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold text-gray-900">{tab.label}</h1>
              <button onClick={() => handleCreateResource(tab.key, tab.label)} className="bg-black text-white px-4 py-2 rounded-lg font-medium text-sm">
                <i className="fa-solid fa-plus mr-1"></i> Nuevo
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {(resourcesByType[tab.key] || []).length === 0 ? (
                <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
                  <i className={`fa-solid ${tab.icon} text-4xl text-gray-200 mb-4`}></i>
                  <p className="text-gray-500">Todavía no hay elementos en "{tab.label}".</p>
                  <button onClick={() => handleCreateResource(tab.key, tab.label)} className="mt-4 text-blue-600 font-medium hover:underline">Crear el primero</button>
                </div>
              ) : (
                (resourcesByType[tab.key] || []).map((r) => (
                  <div key={r.id} className="bg-white border border-gray-200 p-4 rounded-xl flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center text-gray-600">
                        <i className={`fa-solid ${tab.icon}`}></i>
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{r.name}</p>
                        <p className="text-xs text-gray-400">Creado el {new Date(r.createdAt).toLocaleDateString('es-ES')}</p>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteResource(r.id, tab.key)} className="text-gray-400 hover:text-red-500"><i className="fa-solid fa-trash"></i></button>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}

        {activeTab === 'uso' && (
          <div className="max-w-4xl">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Uso general</h1>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex justify-between text-sm border-b border-gray-100 pb-3">
                <span className="text-gray-500">Créditos disponibles</span>
                <span className="font-bold text-gray-900">{fmtEUR(balance)}</span>
              </div>
              <div className="flex justify-between text-sm border-b border-gray-100 pb-3">
                <span className="text-gray-500">Gasto este mes</span>
                <span className="font-bold text-gray-900">{fmtEUR(spend)}</span>
              </div>
              <div className="flex justify-between text-sm border-b border-gray-100 pb-3">
                <span className="text-gray-500">Claves de API activas</span>
                <span className="font-bold text-gray-900">{billing?.clavesActivas ?? 0}</span>
              </div>
              {billing && Object.entries(billing.recursos).map(([tipo, count]) => (
                <div key={tipo} className="flex justify-between text-sm">
                  <span className="text-gray-500 capitalize">{tipo}</span>
                  <span className="font-bold text-gray-900">{count}</span>
                </div>
              ))}
              <p className="text-xs text-gray-400 pt-2">Estos datos reflejan tu actividad real registrada en la base de datos, sin cifras decorativas.</p>
            </div>
          </div>
        )}

        {activeTab === 'admin' && (
          <div className="max-w-6xl">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Panel de Administración</h1>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium">
                  <tr>
                    <th className="px-6 py-3">Usuario</th>
                    <th className="px-6 py-3">Email</th>
                    <th className="px-6 py-3">Rol</th>
                    <th className="px-6 py-3">Créditos</th>
                    <th className="px-6 py-3">Estado</th>
                    <th className="px-6 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {adminUsuarios.map((u) => (
                    <tr key={u.id}>
                      <td className="px-6 py-4 font-medium text-gray-900">{u.nombre}</td>
                      <td className="px-6 py-4 text-gray-500">{u.email}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] border ${u.isAdmin ? 'bg-amber-50 text-amber-600 border-amber-100' : u.isSupport ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                          {u.isAdmin ? 'Admin' : u.isSupport ? 'Soporte' : 'Cliente'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold">{fmtEUR(u.creditos)}</td>
                      <td className="px-6 py-4">
                        <span className={`flex items-center space-x-1 ${u.activo ? 'text-green-500' : 'text-red-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${u.activo ? 'bg-green-500' : 'bg-red-500'}`}></span>
                          <span>{u.activo ? 'Activo' : 'Inactivo'}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4"><button onClick={() => handleEditUsuario(u)} className="text-blue-600 hover:underline">Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
