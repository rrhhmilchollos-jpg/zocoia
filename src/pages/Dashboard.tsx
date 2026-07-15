import React, { useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

interface Agente {
  id: string;
  name: string;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [balance, setBalance] = useState(1645.00);
  const [spend, setSpend] = useState(43.73);
  const [cache] = useState('~1,02 US$');
  const [tokens] = useState('6 M');
  const [agents, setAgents] = useState<Agente[]>([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(true);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    async function fetchServerStatus() {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (res.ok) {
          setServerStatus('online');
        } else {
          setServerStatus('offline');
        }
      } catch (err) {
        setServerStatus('offline');
      }
    }
    fetchServerStatus();
  }, []);

  const handleCreateAgent = async () => {
    const name = prompt('Introduce el nombre de tu nuevo agente de software:');
    if (!name) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/admin/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, limit: 500000 }),
      });
      if (response.ok) {
        setAgents((prev) => [...prev, { id: crypto.randomUUID(), name }]);
      }
    } catch (err) {
      console.error('Error creando agente:', err);
    } finally {
      setLoading(false);
    }
  };

  const modelos = [
    { nombre: 'Fable 5', badge: 'Nuevo', backend: 'maris-beta-70b', equiv: 'Equiv. Fable 5', tags: ['Más capaz', 'Investigación', 'Tareas de varios días'], color: 'border-t-blue-400', bg: 'bg-blue-100' },
    { nombre: 'Opus 4.8', badge: null, backend: 'maris-pro-32b', equiv: 'Equiv. Opus 4.8', tags: ['Proyectos complejos', 'Agentes', 'Programación'], color: 'border-t-orange-400', bg: 'bg-orange-100' },
    { nombre: 'Sonnet 5', badge: 'Nuevo', backend: 'maris-core-7b', equiv: 'Equiv. Sonnet 5', tags: ['Tareas cotidianas', 'Escritura', 'Rentable'], color: 'border-t-gray-400', bg: 'bg-gray-100' },
    { nombre: 'Haiku 4.5', badge: null, backend: 'maris-velox-1b', equiv: 'Equiv. Haiku 4.5', tags: ['Más rápido', 'Menor coste', 'Alto volumen'], color: 'border-t-green-400', bg: 'bg-green-100' },
  ];

  const recursos = [
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
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg bg-gray-100 text-black font-medium">
              <i className="fa-solid fa-house text-gray-600 w-4"></i><span>Panel de control</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50">
              <i className="fa-solid fa-key w-4"></i><span>Claves de API</span>
            </a>

            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Compilar</div>
            <a href="#" className="flex items-center justify-between px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50">
              <div className="flex items-center space-x-3"><i className="fa-solid fa-terminal w-4"></i><span>Área de trabajo</span></div>
              <span className="bg-blue-50 text-blue-600 text-[10px] px-2 py-0.5 rounded-full font-medium border border-blue-100">Actualizado</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-folder w-4"></i><span>Archivos</span></a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-bolt w-4"></i><span>Habilidades</span></a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-layer-group w-4"></i><span>Lotes</span></a>

            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>Agentes gestionados</span><i className="fa-solid fa-chevron-down text-[9px]"></i>
            </div>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-forward w-4"></i><span>Inicio rápido</span></a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-robot w-4"></i><span>Agentes</span></a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-comments w-4"></i><span>Sesiones</span></a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-rocket w-4"></i><span>Implementaciones</span></a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-globe w-4"></i><span>Entornos</span></a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-vault w-4"></i><span>Almacenes de credenciales</span></a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-brain w-4"></i><span>Almacenes de memoria</span></a>

            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>Analíticas</span><i className="fa-solid fa-chevron-right text-[9px]"></i>
            </div>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-chart-simple w-4"></i><span>Uso general</span></a>

            <div className="pt-2">
              <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-shield w-4"></i><span>Administración</span></a>
            </div>
          </nav>
        </div>

        <div className="border-t border-gray-200 pt-4 space-y-3">
          <a href="#" className="flex items-center space-x-2 px-2 text-gray-500 hover:text-gray-700">
            <i className="fa-solid fa-book w-4"></i><span>Documentación</span>
          </a>
          <div className="flex items-center justify-between p-2 rounded-lg border border-gray-100 bg-gray-50">
            <div>
              <p className="font-bold text-gray-900">{balance.toFixed(2)} US$</p>
              <p className="text-[11px] text-gray-400">Añadir fondos</p>
            </div>
            <button onClick={() => setBalance((p) => p + 100)} className="text-[11px] text-blue-600 hover:underline font-medium">
              <i className="fa-solid fa-plus"></i>
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
              <span>El acceso a tus <strong>{agents.length + 11} agentes de software</strong> ha sido restaurado con éxito.</span>
            </div>
            <button onClick={() => setNotification(false)} className="text-gray-400 hover:text-gray-600 text-lg font-bold leading-none">&times;</button>
          </div>
        )}

        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Buenas tardes, Maria</h1>
          <div className="flex items-center space-x-2 text-[13px]">
            <span
              title={serverStatus === 'online' ? 'Backend conectado' : 'Backend no disponible'}
              className={`w-2 h-2 rounded-full ${serverStatus === 'online' ? 'bg-green-500' : serverStatus === 'offline' ? 'bg-red-500' : 'bg-gray-300'}`}
            ></span>
            <button className="bg-white border border-gray-300 text-gray-700 px-4 py-1.5 rounded-lg font-medium shadow-sm hover:bg-gray-50">
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
            <div className="text-2xl font-bold text-gray-900 mt-1">{balance.toFixed(2)} US$</div>
            <button className="text-red-500 text-[11px] font-medium hover:underline mt-2 block">Activar recarga automática</button>
          </div>
          <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
            <div className="flex justify-between items-start">
              <div className="text-gray-400 font-medium">Gasto este mes</div>
              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">4% utilizado</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{spend.toFixed(2)} US$</div>
            <div className="text-gray-400 text-[11px] mt-2">de 1000 US$ de límite · se restablece el 1 ago.</div>
          </div>
          <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm flex justify-between items-start">
            <div>
              <div className="text-gray-400 font-medium">Caché</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{cache}</div>
              <div className="text-gray-400 text-[11px] mt-2">ahorro est. últimos 7 días</div>
            </div>
            <div className="text-green-600 font-semibold text-[11px] bg-green-50 px-2 py-1 rounded-md border border-green-100">6% de tasa de aciertos</div>
          </div>
        </div>

        {/* TOKENS */}
        <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm mb-8 text-[13px]">
          <div className="text-gray-400 font-medium mb-4">Volumen de tokens</div>
          <div className="flex justify-between items-end h-24">
            <div>
              <div className="text-2xl font-bold text-gray-900">{tokens}</div>
              <div className="text-xs text-gray-400 font-normal">últimos 7 días</div>
            </div>
            <div className="flex items-end space-x-2 h-full">
              <div className="w-8 bg-green-200 h-8 rounded-t"></div>
              <div className="w-8 bg-green-200 h-10 rounded-t"></div>
              <div className="w-8 bg-green-300 h-14 rounded-t"></div>
              <div className="w-8 bg-green-400 h-16 rounded-t"></div>
              <div className="w-8 bg-green-400 h-20 rounded-t"></div>
              <div className="w-8 bg-green-500 h-24 rounded-t"></div>
            </div>
          </div>
        </div>

        {/* MODELOS */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900">Modelos</h2>
          <a href="#" className="text-[13px] text-gray-500 hover:underline">Comparar modelos</a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 text-[12px]">
          {modelos.map((m) => (
            <div key={m.nombre} className={`bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col`}>
              <div className={`${m.bg} h-20 flex items-center justify-center`}>
                <i className="fa-solid fa-robot text-2xl text-gray-700"></i>
              </div>
              <div className="p-4 flex flex-col justify-between flex-1">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-sm text-gray-900">{m.nombre}</span>
                  {m.badge && <span className="bg-blue-50 text-blue-600 text-[10px] px-1.5 py-0.5 rounded font-medium border border-blue-100">{m.badge}</span>}
                </div>
                <p className="text-gray-400 text-[11px] font-mono leading-tight mb-3">{m.backend} · {m.equiv}</p>
                <div className="flex flex-wrap gap-1">
                  {m.tags.map((t) => (
                    <span key={t} className="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-full">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* RECURSOS */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Recursos</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-[12px] pb-8">
          {recursos.map((r) => (
            <div key={r.titulo} className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm">
              <div className="flex items-center space-x-2 mb-2">
                <i className={`fa-solid ${r.icono} text-gray-500`}></i>
                <span className="font-bold text-sm text-gray-900">{r.titulo}</span>
                {r.badge && <span className="bg-purple-50 text-purple-600 text-[10px] px-1.5 py-0.5 rounded font-medium border border-purple-100">{r.badge}</span>}
              </div>
              <p className="text-gray-500 text-[11px] leading-relaxed">{r.texto}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
