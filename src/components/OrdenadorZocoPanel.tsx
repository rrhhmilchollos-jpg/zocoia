import React, { useState, useEffect, useRef } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'command' | 'success' | 'error';
}

export default function OrdenadorZocoPanel() {
  const { token } = useAuth();
  const [url, setUrl] = useState('https://www.google.com');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSandbox, setActiveSandbox] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    }]);
  };

  const executeAction = async (action: string, params: any = {}) => {
    setLoading(true);
    addLog(`Ejecutando ${action}...`, 'command');
    
    try {
      const res = await fetch(`${API_BASE}/api/ordenador-zoco`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, ...params })
      });
      
      const data = await res.json();
      
      if (data.success) {
        if (data.screenshot) setScreenshot(data.screenshot);
        addLog(data.message || 'Acción completada', 'success');
      } else {
        addLog(data.error || 'Error en la acción', 'error');
      }
    } catch (err) {
      addLog('Error de conexión con el servidor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = () => {
    if (!url) return;
    executeAction('navigate', { url });
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] rounded-xl border border-[#222] overflow-hidden shadow-2xl">
      <div className="bg-[#151515] p-3 border-b border-[#222] flex items-center space-x-3">
        <div className="flex space-x-1.5 px-2">
          <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
          <div className="w-3 h-3 rounded-full bg-amber-500/50"></div>
          <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
        </div>
        <div className="flex-1 flex items-center bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-1.5">
          <span className="text-gray-600 mr-2 text-xs">🔒</span>
          <input 
            type="text" 
            value={url} 
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleNavigate()}
            className="bg-transparent border-none outline-none text-gray-300 text-xs w-full"
            placeholder="Introduce una URL..."
          />
        </div>
        <button 
          onClick={handleNavigate}
          disabled={loading}
          className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
        >
          {loading ? 'Cargando...' : 'IR'}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-[3] bg-[#111] relative flex items-center justify-center border-r border-[#222]">
          {screenshot ? (
            <img 
              src={`data:image/png;base64,${screenshot}`} 
              alt="Escritorio de Zoco" 
              className="max-w-full max-h-full object-contain shadow-2xl"
            />
          ) : (
            <div className="text-center space-y-4">
              <div className="text-6xl animate-pulse opacity-20">🖥️</div>
              <p className="text-gray-600 text-sm font-medium">El Ordenador de Zoco está en espera</p>
              <button 
                onClick={() => executeAction('screenshot')}
                className="text-purple-500 text-xs hover:underline"
              >
                Inicializar entorno →
              </button>
            </div>
          )}
          
          {loading && (
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center">
              <div className="flex flex-col items-center space-y-3">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-white text-xs font-bold tracking-widest uppercase">Accediendo al núcleo...</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 bg-[#0f0f0f] flex flex-col">
          <div className="p-3 border-b border-[#222] bg-[#151515]">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Monitorización en Tiempo Real</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-2 scrollbar-thin scrollbar-thumb-[#333]">
            {logs.length === 0 && (
              <p className="text-gray-700 italic">Esperando actividad del sistema...</p>
            )}
            {logs.map((log, i) => (
              <div key={i} className="flex flex-col border-l border-[#333] pl-2 py-0.5">
                <span className="text-gray-600 text-[8px]">{log.timestamp}</span>
                <span className={`
                  ${log.type === 'command' ? 'text-blue-400' : ''}
                  ${log.type === 'success' ? 'text-green-400' : ''}
                  ${log.type === 'error' ? 'text-red-400 font-bold' : ''}
                  ${log.type === 'info' ? 'text-gray-400' : ''}
                `}>
                  {log.type === 'command' && '> '}
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
