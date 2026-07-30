/**
 * ManusAgentPanel.tsx
 * 
 * Componente visual de terminal para los Agentes Autónomos estilo Manus.
 * Conecta con el backend vía SSE para mostrar la ejecución en tiempo real
 * en una consola negra profesional.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';
import { Terminal, Play, Square, Loader2, CheckCircle2, AlertCircle, Copy, ChevronRight } from 'lucide-react';

interface LogEntry {
  id: string;
  type: 'stdout' | 'stderr' | 'status' | 'command' | 'error' | 'info';
  message: string;
  timestamp: Date;
}

export default function ManusAgentPanel() {
  const { token } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll al final de los logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      type,
      message,
      timestamp: new Date()
    }]);
  };

  const handleRun = () => {
    if (!prompt.trim() || isRunning) return;

    setIsRunning(true);
    setStatus('running');
    setLogs([]);
    addLog('info', `Iniciando ciclo autónomo para: "${prompt}"`);

    // Construir URL de SSE
    const url = new URL(`${API_BASE}/api/agent/run/stream`);
    url.searchParams.append('prompt', prompt);
    // En producción, el token se suele pasar por query param para EventSource
    url.searchParams.append('token', token || '');

    const es = new EventSource(url.toString());
    eventSourceRef.current = es;

    es.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      addLog('status', data.message);
    });

    es.addEventListener('command', (e) => {
      const data = JSON.parse(e.data);
      addLog('command', data.command);
    });

    es.addEventListener('stdout', (e) => {
      const data = JSON.parse(e.data);
      addLog('stdout', data.chunk);
    });

    es.addEventListener('stderr', (e) => {
      const data = JSON.parse(e.data);
      addLog('stderr', data.chunk);
    });

    es.addEventListener('done', (e) => {
      const data = JSON.parse(e.data);
      addLog('status', `Proceso finalizado (Código: ${data.exitCode})`);
      setStatus('success');
      setIsRunning(false);
      es.close();
    });

    es.addEventListener('error', (e) => {
      const data = JSON.parse(e.data);
      addLog('error', data.message);
      setStatus('error');
      setIsRunning(false);
      es.close();
    });

    es.onerror = () => {
      // Evitar logs duplicados si ya cerramos por error
      if (es.readyState !== EventSource.CLOSED) {
        addLog('error', 'Desconectado del servidor de streaming.');
        setStatus('error');
        setIsRunning(false);
        es.close();
      }
    };
  };

  const handleStop = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      setIsRunning(false);
      setStatus('idle');
      addLog('info', 'Ejecución interrumpida por el usuario.');
    }
  };

  const copyLogs = () => {
    const text = logs.map(l => `[${l.timestamp.toISOString()}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-120px)] bg-[#0d0d0d] rounded-xl border border-[#2a2a2a] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
      {/* Barra Superior Estilo macOS/Terminal */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#1a1a1a] border-b border-[#2a2a2a]">
        <div className="flex items-center space-x-4">
          <div className="flex space-x-1.5">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
            <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
          </div>
          <div className="flex items-center space-x-2 text-[#999] font-medium text-xs uppercase tracking-widest">
            <Terminal className="w-3.5 h-3.5" />
            <span>zoco-autonomous-agent — bash</span>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button 
            onClick={copyLogs}
            className="p-1.5 text-[#666] hover:text-white transition-colors"
            title="Copiar logs"
          >
            <Copy className="w-4 h-4" />
          </button>
          <div className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
            status === 'running' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 
            status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
            status === 'error' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
            'bg-gray-500/10 text-gray-500 border border-gray-500/20'
          }`}>
            {status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{status}</span>
          </div>
        </div>
      </div>

      {/* Cuerpo de la Terminal */}
      <div 
        ref={scrollRef}
        className="flex-1 p-6 font-mono text-[13px] leading-relaxed overflow-y-auto custom-terminal-scrollbar bg-[#0d0d0d]"
      >
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[#333] space-y-4">
            <Terminal className="w-16 h-16 opacity-20" />
            <div className="text-center">
              <p className="text-lg font-light tracking-tight">Zoco Autonomous Engine</p>
              <p className="text-xs opacity-50 mt-1">Introduce una instrucción para comenzar el ciclo de vida</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {logs.map(log => (
              <div key={log.id} className="group flex items-start space-x-3">
                <span className="text-[#333] shrink-0 select-none w-[75px] text-[10px] pt-1">
                  {log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <div className={`flex-1 break-all whitespace-pre-wrap ${
                  log.type === 'stderr' || log.type === 'error' ? 'text-rose-400' :
                  log.type === 'command' ? 'text-purple-400 font-bold' :
                  log.type === 'status' ? 'text-blue-400 italic' :
                  log.type === 'info' ? 'text-[#666]' :
                  'text-gray-300'
                }`}>
                  {log.type === 'command' && <span className="text-purple-600 mr-2">$</span>}
                  {log.message}
                </div>
              </div>
            ))}
            {isRunning && (
              <div className="flex items-center space-x-2 text-purple-500/50 animate-pulse mt-2">
                <ChevronRight className="w-4 h-4" />
                <span className="w-2 h-4 bg-purple-500/50"></span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input de Comandos */}
      <div className="p-5 bg-[#141414] border-t border-[#2a2a2a]">
        <div className="relative group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <ChevronRight className={`w-5 h-5 ${isRunning ? 'text-gray-600' : 'text-purple-500 group-focus-within:text-purple-400'}`} />
          </div>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRun()}
            placeholder="¿Qué quieres que el agente construya hoy?"
            className="w-full bg-[#080808] border border-[#2a2a2a] rounded-xl pl-12 pr-14 py-4 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 focus:ring-4 focus:ring-purple-500/5 transition-all shadow-inner"
            disabled={isRunning}
          />
          <div className="absolute right-3 inset-y-0 flex items-center">
            {isRunning ? (
              <button
                onClick={handleStop}
                className="p-2.5 bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white rounded-lg transition-all"
                title="Abortar"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={handleRun}
                disabled={!prompt.trim()}
                className="p-2.5 bg-purple-500 text-white hover:bg-purple-400 disabled:bg-[#222] disabled:text-[#444] rounded-lg transition-all shadow-lg shadow-purple-500/20"
                title="Ejecutar ciclo"
              >
                <Play className="w-4 h-4 fill-current" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between text-[10px] text-[#444] font-medium uppercase tracking-tighter">
          <div className="flex items-center space-x-4">
            <span>Infra: E2B Desktop Sandbox</span>
            <span>Engine: Groq Llama-3.3-70B</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
            <span>System Online</span>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-terminal-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-terminal-scrollbar::-webkit-scrollbar-track { background: #0d0d0d; }
        .custom-terminal-scrollbar::-webkit-scrollbar-thumb { background: #222; border-radius: 4px; border: 2px solid #0d0d0d; }
        .custom-terminal-scrollbar::-webkit-scrollbar-thumb:hover { background: #333; }
      `}} />
    </div>
  );
}
