import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  const [balance] = useState(1645.00);
  const [spend] = useState(43.73);
  const [cache] = useState('~1,02 US$');
  const [tokens] = useState('6 M');
  const [notification, setNotification] = useState(true);

  return (
    <div class="flex h-screen bg-[#fafafa] text-gray-800 antialiased font-sans">
      
      {/* BARRA LATERAL IZQUIERDA */}
      <aside class="w-64 bg-white border-r border-gray-200 flex flex-col justify-between p-4 z-10 text-[13px]">
        <div>
          {/* Selector de organización superior */}
          <div class="flex items-center justify-between px-2 py-2 border border-gray-200 rounded-lg bg-gray-50 mb-6 cursor-pointer hover:bg-gray-100 transition">
            <div class="flex items-center space-x-2">
              <div class="w-5 h-5 bg-black rounded flex items-center justify-center text-white text-[10px] font-bold">Z</div>
              <span class="font-semibold text-gray-700">Zoco IA</span>
            </div>
            <i class="fa-solid fa-chevron-up-down text-gray-400 text-[10px]"></i>
          </div>

          {/* Menú de Navegación Principal */}
          <nav class="space-y-1">
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg bg-gray-100 text-black font-medium transition">
              <i class="fa-solid fa-house text-gray-600 w-4"></i>
              <span>Panel de control</span>
            </a>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-key w-4"></i>
              <span>Claves de API</span>
            </a>
            
            <div class="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Compilar</div>
            <a href="#" class="flex items-center justify-between px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <div class="flex items-center space-x-3">
                <i class="fa-solid fa-terminal w-4"></i>
                <span>Área de trabajo</span>
              </div>
              <span class="bg-blue-50 text-blue-600 text-[10px] px-2 py-0.5 rounded-full font-medium border border-blue-100">Actualizado</span>
            </a>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-folder w-4"></i>
              <span>Archivos</span>
            </a>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-wand-magic-sparkles w-4"></i>
              <span>Habilidades</span>
            </a>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-layer-group w-4"></i>
              <span>Lotes</span>
            </a>

            <div class="pt-4 pb-1 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Agentes gestionados</div>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-bolt w-4"></i>
              <span>Inicio rápido</span>
            </a>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-robot w-4"></i>
              <span>Agentes</span>
            </a>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-comments w-4"></i>
              <span>Sesiones</span>
            </a>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-server w-4"></i>
              <span>Implementaciones</span>
            </a>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-network-wired w-4"></i>
              <span>Entornos</span>
            </a>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-id-card w-4"></i>
              <span>Almacenes de credenciales</span>
            </a>
            <a href="#" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition">
              <i class="fa-solid fa-brain w-4"></i>
              <span>Almacenes de memoria</span>
            </a>
          </nav>
        </div>

        {/* Sección inferior de perfil */}
        <div class="border-t border-gray-200 pt-4 space-y-3">
          <a href="#" class="flex items-center space-x-3 text-gray-600 hover:text-black transition px-2">
            <i class="fa-solid fa-file-text w-4"></i>
            <span>Documentación</span>
          </a>
          <div class="flex items-center justify-between p-2 rounded-lg border border-gray-100 bg-gray-50">
            <div>
              <p class="font-bold text-gray-900">{balance.toFixed(2)} US$</p>
              <p class="text-[11px] text-gray-400">Créditos actuales</p>
            </div>
            <button class="text-[11px] text-blue-600 hover:underline font-medium">Añadir fondos</button>
          </div>
          <div class="flex items-center justify-between px-2 pt-1 cursor-pointer">
            <div class="flex items-center space-x-2">
              <div class="w-7 h-7 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold text-xs">M</div>
              <div>
                <p class="font-semibold text-gray-800 leading-tight">Maria</p>
                <p class="text-[10px] text-gray-400">Admin - Maris AI</p>
              </div>
            </div>
            <i class="fa-solid fa-chevron-up text-gray-400 text-[10px]"></i>
          </div>
        </div>
      </aside>

      {/* ÁREA CENTRAL */}
      <main class="flex-1 overflow-y-auto bg-[#fafafa] p-8">
        
        {/* Alerta azul superior */}
        {notification && (
          <div class="bg-[#edf5fd] border border-[#d4e8fc] text-[#1d6cd3] text-[13px] px-4 py-2.5 rounded-lg flex items-center justify-between mb-8 shadow-sm">
            <div class="flex items-center space-x-2">
              <i class="fa-solid fa-circle-info"></i>
              <span>El acceso a tus <strong>11 agentes de software</strong> ha sido restaurado con éxito.</span>
            </div>
            <button onClick={() => setNotification(false)} class="text-gray-400 hover:text-gray-600 text-lg font-bold">&times;</button>
          </div>
        )}

        {/* Cabecera */}
        <div class="flex justify-between items-center mb-8">
          <h1 class="text-2xl font-bold tracking-tight text-gray-900">Buenas tardes, Maria</h1>
          <div class="flex space-x-2 text-[13px]">
            <button class="bg-white border border-gray-300 text-gray-700 px-4 py-1.5 rounded-lg font-medium hover:bg-gray-50 shadow-sm transition"><i class="fa-solid fa-key mr-2 text-gray-400"></i>Obtener clave de API</button>
            <button class="bg-black text-white px-4 py-1.5 rounded-lg font-medium hover:bg-gray-800 shadow-sm transition"><i class="fa-solid fa-plus mr-2 text-gray-300"></i>Crear un agente</button>
          </div>
        </div>

        {/* BLOQUE DE MÉTRICAS */}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 text-[13px]">
          <div class="bg-white border border-gray-200 p-5 rounded-xl shadow-sm relative overflow-hidden">
            <div class="text-gray-400 font-medium flex items-center space-x-1">
              <span>Créditos de la organización</span>
              <i class="fa-regular fa-circle-question text-[11px]"></i>
            </div>
            <div class="text-2xl font-bold text-gray-900 mt-1">{balance.toFixed(2)} US$</div>
            <button class="text-red-500 text-[11px] font-medium hover:underline mt-2 block">Activar recarga automática</button>
            <button class="absolute top-5 right-5 bg-black text-white text-[11px] px-3 py-1 rounded-md font-medium hover:bg-gray-800 transition">Añadir fondos</button>
          </div>
          
          <div class="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
            <div class="text-gray-400 font-medium">Gasto este mes</div>
            <div class="text-2xl font-bold text-gray-900 mt-1">{spend.toFixed(2)} US$</div>
            <div class="text-gray-400 text-[11px] mt-2">de 1000 US$ de límite • se restablece el 1 ago.</div>
            <div class="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden"><div class="bg-gray-300 h-full w-[4%]"></div></div>
          </div>

          <div class="bg-white border border-gray-200 p-5 rounded-xl shadow-sm flex justify-between items-center">
            <div>
              <div class="text-gray-400 font-medium flex items-center space-x-1">
                <span>Caché</span>
                <i class="fa-regular fa-circle-question text-[11px]"></i>
              </div>
              <div class="text-2xl font-bold text-gray-900 mt-1">{cache}</div>
              <div class="text-gray-400 text-[11px] mt-2">ahorro est. últimos 7 días</div>
            </div>
            <div class="text-green-600 font-semibold text-[11px] bg-green-50 px-2 py-1 rounded-md border border-green-100">0% de tasa de aciertos</div>
          </div>
        </div>

        {/* GRÁFICO VOLUMEN DE TOKENS */}
        <div class="bg-white border border-gray-200 p-5 rounded-xl shadow-sm mb-8 text-[13px]">
          <div class="text-gray-400 font-medium flex items-center space-x-1 mb-4">
            <span>Volumen de tokens transaccionados</span>
