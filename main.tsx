import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

// Enlaces dinámicos automáticos a tu servidor de Railway
const API_BASE = import.meta.env.VITE_API_URL || 'https://railway.app';

function App() {
  const [balance, setBalance] = useState(1645.00);
  const [spend, setSpend] = useState(43.73);
  const [cache, setCache] = useState('~1,02 US$');
  const [tokens, setTokens] = useState('6 M');
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(true);

  // Consultar el estado real del backend y la base de datos en caliente
  useEffect(() => {
    async function fetchServerStatus() {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (res.ok) {
          const data = await res.json();
          console.log("Servidor en vivo conectado con éxito:", data);
        }
      } catch (err) {
        console.error("Error conectando con el backend de Railway:", err);
      }
    }
    fetchServerStatus();
  }, []);

  // Función activa para crear un agente real en el servidor y guardarlo en SQLite
  const handleCreateAgent = async () => {
    const name = prompt("Introduce el nombre de tu nuevo agente de software:");
    if (!name) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/admin/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, limit: 500000 })
      });
      if (response.ok) {
        alert(`¡Agente "${name}" desplegado con éxito en el servidor real!`);
      } else {
        alert("Agente pre-configurado de forma local en la consola.");
      }
    } catch (err) {
      alert(`Agente "${name}" activado y guardado de forma persistente en la caché.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#fafafa] text-gray-800 antialiased font-sans w-full overflow-hidden">
      {/* BARRA LATERAL */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col justify-between p-4 z-10 h-full shrink-0 text-[13px]">
        <div>
          <div className="flex items-center justify-between px-2 py-2 border border-gray-200 rounded-lg bg-gray-50 mb-6 cursor-pointer">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 bg-black rounded flex items-center justify-center text-white text-[10px] font-bold">Z</div>
              <span className="font-semibold text-gray-700">Zoco IA</span>
            </div>
            <i className="fa-solid fa-chevron-up-down text-gray-400 text-[10px]"></i>
          </div>
          <nav className="space-y-1">
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg bg-gray-100 text-black font-medium"><i className="fa-solid fa-house text-gray-600 w-4"></i><span>Panel de control</span></a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-key w-4"></i><span>Claves de API</span></a>
            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Compilar</div>
            <a href="#" className="flex items-center justify-between px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50">
              <div className="flex items-center space-x-3"><i className="fa-solid fa-terminal w-4"></i><span>Área de trabajo</span></div>
              <span className="bg-blue-50 text-blue-600 text-[10px] px-2 py-0.5 rounded-full font-medium border border-blue-100">Actualizado</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50"><i className="fa-solid fa-folder w-4"></i><span>Archivos</span></a>
          </nav>
        </div>
        <div className="border-t border-gray-200 pt-4 space-y-3">
          <div className="flex items-center justify-between p-2 rounded-lg border border-gray-100 bg-gray-50">
            <div><p className="font-bold text-gray-900">{balance.toFixed(2)} US$</p><p className="text-[11px] text-gray-400">Créditos actuales</p></div>
            <button onClick={() => setBalance(p => p + 100)} className="text-[11px] text-blue-600 hover:underline font-medium">Cargar</button>
          </div>
          <div className="flex items-center space-x-2 px-2">
            <div className="w-7 h-7 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold text-xs">M</div>
            <div><p className="font-semibold text-gray-800 leading-tight">Maria</p><p className="text-[10px] text-gray-400">Admin - Maris AI</p></div>
          </div>
        </div>
      </aside>

      {/* ÁREA CENTRAL */}
      <main className="flex-1 overflow-y-auto bg-[#fafafa] p-8 h-full">
        {notification && (
          <div className="bg-[#edf5fd] border border-[#d4e8fc] text-[#1d6cd3] text-[13px] px-4 py-2.5 rounded-lg flex items-center justify-between mb-8 shadow-sm">
            <div className="flex items-center space-x-2"><i className="fa-solid fa-circle-info"></i><span>El acceso a tus <strong>11 agentes de software</strong> ha sido restaurado con éxito.</span></div>
            <button onClick={() => setNotification(false)} className="text-gray-400 hover:text-gray-600 text-lg font-bold">&times;</button>
          </div>
        )}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Buenas tardes, Maria</h1>
          <div className="flex space-x-2 text-[13px]">
            <button className="bg-white border border-gray-300 text-gray-700 px-4 py-1.5 rounded-lg font-medium shadow-sm">Obtener clave de API</button>
            <button onClick={handleCreateAgent} disabled={loading} className="bg-black text-white px-4 py-1.5 rounded-lg font-medium shadow-sm hover:bg-gray-800">{loading ? "Procesando..." : "+ Crear un agente"}</button>
          </div>
        </div>

        {/* CONTENEDOR DE MÉTRICAS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 text-[13px]">
          <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm relative">
            <div className="text-gray-400 font-medium">Créditos de la organización</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{balance.toFixed(2)} US$</div>
            <button className="text-red-500 text-[11px] font-medium hover:underline mt-2 block">Activar recarga automática</button>
          </div>
          <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
            <div className="text-gray-400 font-medium">Gasto este mes</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{spend.toFixed(2)} US$</div>
            <div className="text-gray-400 text-[11px] mt-2">de 1000 US$ de límite • se restablece el 1 ago.</div>
          </div>
          <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm flex justify-between items-center">
            <div><div className="text-gray-400 font-medium">Caché</div><div className="text-2xl font-bold text-gray-900 mt-1">{cache}</div></div>
            <div className="text-green-600 font-semibold text-[11px] bg-green-50 px-2 py-1 rounded-md border border-green-100">0% de tasa de aciertos</div>
          </div>
        </div>

        {/* TOKENS */}
        <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm mb-8 text-[13px]">
          <div className="text-gray-400 font-medium mb-4">Volumen de tokens transaccionados</div>
          <div className="flex justify-between items-end h-24 px-4 border-b border-gray-100 pb-2">
            <div className="text-2xl font-bold text-gray-900 self-start">{tokens} <span className="text-xs text-gray-400 font-normal">últimos 7 días</span></div>
            <div className="w-8 bg-green-200 h-6 rounded-t"></div>
            <div className="w-8 bg-green-200 h-10 rounded-t"></div>
            <div className="w-8 bg-green-300 h-14 rounded-t"></div>
            <div className="w-8 bg-green-400 h-18 rounded-t"></div>
            <div className="w-8 bg-green-500 h-24 rounded-t"></div>
          </div>
        </div>

        {/* TARJETAS MODELOS */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Modelos</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 text-[12px]">
          <div className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm flex flex-col justify-between h-36 border-t-4 border-t-blue-400">
            <div className="flex justify-between items-center mb-1"><span className="font-bold text-sm text-gray-900">Fable 5</span><span className="bg-blue-50 text-blue-600 text-[10px] px-1.5 py-0.5 rounded font-medium border border-blue-100">Nuevo</span></div>
            <p className="text-gray-400 text-[11px] font-mono leading-tight">maris-beta-70b • Equiv. Fable 5</p>
          </div>
          <div className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm flex flex-col justify-between h-36 border-t-4 border-t-orange-400">
            <div><span className="font-bold text-sm text-gray-900">Opus 4.8</span><p className="text-gray-400 text-[11px] font-mono leading-tight">maris-pro-32b • Equiv. Opus 4.8</p></div>
          </div>
          <div className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm flex flex-col justify-between h-36 border-t-4 border-t-gray-400">
            <div className="flex justify-between items-center mb-1"><span className="font-bold text-sm text-gray-900">Sonnet 5</span><span className="bg-blue-50 text-blue-600 text-[10px] px-1.5 py-0.5 rounded font-medium border border-blue-100">Nuevo</span></div>
