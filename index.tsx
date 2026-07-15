import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  const [balance] = useState(1645.0);
  const [spend] = useState(43.73);
  const [cache] = useState('~1,02 US$');
  const [tokens] = useState('6 M');
  const [notification, setNotification] = useState(true);

  return (
    <div className="flex h-screen bg-[#fafafa] text-gray-800 antialiased font-sans w-full">
      {/* BARRA LATERAL IZQUIERDA */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col justify-between p-4 z-10 text-[13px] shrink-0">
        <div>
          {/* Selector de organización superior */}
          <div className="flex items-center justify-between px-2 py-2 border border-gray-200 rounded-lg bg-gray-50 mb-6 cursor-pointer hover:bg-gray-100 transition">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 bg-black rounded flex items-center justify-center text-white text-[10px] font-bold">Z</div>
              <span className="font-semibold text-gray-700">Zoco IA</span>
            </div>
            <i className="fa-solid fa-chevron-up-down text-gray-400 text-[10px]"></i>
          </div>

          {/* Menú de Navegación Principal */}
          <nav className="space-y-1">
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg bg-gray-100 text-black font-medium transition">
              <i className="fa-solid fa-house text-gray-600 w-4"></i>
              <span>Panel de control</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-key w-4"></i>
              <span>Claves de API</span>
            </a>

            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Compilar</div>
            <a href="#" className="flex items-center justify-between px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <div className="flex items-center space-x-3">
                <i className="fa-solid fa-terminal w-4"></i>
                <span>Área de trabajo</span>
              </div>
              <span className="bg-blue-50 text-blue-600 text-[10px] px-2 py-0.5 rounded-full font-medium border border-blue-100">Actualizado</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-folder w-4"></i>
              <span>Archivos</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-wand-magic-sparkles w-4"></i>
              <span>Habilidades</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-layer-group w-4"></i>
              <span>Lotes</span>
            </a>

            <div className="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Agentes gestionados</div>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-bolt w-4"></i>
              <span>Inicio rápido</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-robot w-4"></i>
              <span>Agentes</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-comments w-4"></i>
              <span>Sesiones</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-server w-4"></i>
              <span>Implementaciones</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-network-wired w-4"></i>
              <span>Entornos</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-id-card w-4"></i>
              <span>Almacenes de credenciales</span>
            </a>
            <a href="#" className="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i className="fa-solid fa-brain w-4"></i>
              <span>Almacenes de memoria</span>
            </a>
          </nav>
        </div>

        {/* Sección inferior de perfil */}
        <div className="border-t border-gray-200 pt-4 space-y-3">
          <a href="#" className="flex items-center space-x-3 text-gray-600 hover:text-black transition px-2">
            <i className="fa-solid fa-file-text w-4"></i>
            <span>Documentación</span>
          </a>
          <div class="flex items-center justify-between p-2 rounded-lg border border-gray-100 bg-gray-50">
            <div>
              <p className="font-bold text-gray-900">{balance.toFixed(2)} US$</p>
              <p className="text-[11px] text-gray-400">Créditos actuales</p>
            </div>
            <button className="text-[11px] text-blue-600 hover:underline font-medium">Añadir fondos</button>
          </div>
          <div className="flex items-center justify-between px-2 pt-1 cursor-pointer">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold text-xs">M</div>
              <div>
                <p class="font-semibold text-gray-800 leading-tight">Maria</p>
                <p className="text-[10px] text-gray-400">Admin - Maris AI</p>
              </div>
            </div>
            <i className="fa-solid fa-chevron-up text-gray-400 text-[10px]"></i>
          </div>
        </div>
      </aside>

      {/* ÁREA CENTRAL */}
      <main className="flex-1 overflow-y-auto bg-[#fafafa] p-8">
        {/* Alerta azul superior */}
        {notification && (
          <div className="bg-[#edf5fd] border border-[#d4e8fc] text-[#1d6cd3] text-[13px] px-4 py-2.5 rounded-lg flex items-center justify-between mb-8 shadow-sm">
            <div className="flex items-center space-x-2">
              <i className="fa-solid fa-circle-info"></i>
              <span>El acceso a tus <strong>11 agentes de software</strong> ha sido restaurado con éxito.</span>
            </div>
            <button onClick={() => setNotification(false)} className="text-gray-400 hover:text-gray-600 text-lg font-bold">&times;</button>
          </div>
        )}

        {/* Cabecera */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Buenas tardes, Maria</h1>
          <div className="flex space-x-2 text-[13px]">
            <button className="bg-white border border-gray-300 text-gray-700 px-4 py-1.5 rounded-lg font-medium hover:bg-gray-50 shadow-sm transition">
              <i className="fa-solid fa-key mr-2 text-gray-400"></i>Obtener clave de API
            </button>
            <button className="bg-black text-white px-4 py-1.5 rounded-lg font-medium hover:bg-gray-800 shadow-sm transition">
              <i className="fa-solid fa-plus mr-2 text-gray-300"></i>Crear un agente
            </button>
          </div>
        </div>

        {/* BLOQUE DE MÉTRICAS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 text-[13px]">
          <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm relative overflow-hidden">
            <div className="text-gray-400 font-medium flex items-center space-x-1">
              <span>Créditos de la organización</span>
              <i className="fa-regular fa-circle-question text-[11px]"></i>
            </div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{balance.toFixed(2)} US$</div>
            <button className="text-red-500 text-[11px] font-medium hover:underline mt-2 block">Activar recarga automática</button>
            <button className="absolute top-5 right-5 bg-black text-white text-[11px] px-3 py-1 rounded-md font-medium hover:bg-gray-800 transition">Añadir fondos</button>
          </div>

          <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
            <div className="text-gray-400 font-medium">Gasto este mes</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{spend.toFixed(2)} US$</div>
            <div className="text-gray-400 text-[11px] mt-2">de 1000 US$ de límite • se restablece el 1 ago.</div>
            <div className="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden">
              <div className="bg-gray-300 h-full w-[4%]"></div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm flex justify-between items-center">
            <div>
              <div className="text-gray-400 font-medium flex items-center space-x-1">
                <span>Caché</span>
                <i className="fa-regular fa-circle-question text-[11px]"></i>
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{cache}</div>
              <div className="text-gray-400 text-[11px] mt-2">ahorro est. últimos 7 días</div>
            </div>
