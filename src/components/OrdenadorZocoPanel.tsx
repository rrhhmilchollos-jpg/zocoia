import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Copy, RefreshCw, Maximize2, Minimize2, X } from 'lucide-react';

interface OrdenadorZocoPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ScreenshotData {
  screenshot: string;
  url: string;
  timestamp: number;
}

interface LogEntry {
  id: string;
  timestamp: number;
  action: string;
  status: 'pending' | 'success' | 'error';
  message: string;
}

const OrdenadorZocoPanel: React.FC<OrdenadorZocoPanelProps> = ({ isOpen, onClose }) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [currentScreenshot, setCurrentScreenshot] = useState<ScreenshotData | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('https://www.zocoia.es');
  const [urlInput, setUrlInput] = useState(currentUrl);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (action: string, status: 'pending' | 'success' | 'error', message: string) => {
    const logEntry: LogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      action,
      status,
      message,
    };
    setLogs(prev => [...prev, logEntry]);
  };

  const executeAction = async (action: string, params: Record<string, any> = {}) => {
    setIsLoading(true);
    const logId = `${Date.now()}-${Math.random()}`;
    addLog(action, 'pending', `Ejecutando ${action}...`);

    try {
      const response = await fetch('/api/ordenador-zoco', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...params }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        if (data.screenshot) {
          setCurrentScreenshot({
            screenshot: data.screenshot,
            url: data.url || currentUrl,
            timestamp: Date.now(),
          });
          setCurrentUrl(data.url || currentUrl);
        }
        addLog(action, 'success', `✓ ${action} completado exitosamente`);
      } else {
        addLog(action, 'error', `✗ Error: ${data.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      addLog(action, 'error', `✗ Error: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigate = () => {
    if (urlInput.trim()) {
      executeAction('navigate', { url: urlInput });
      setCurrentUrl(urlInput);
    }
  };

  const handleScreenshot = () => {
    executeAction('screenshot');
  };

  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!currentScreenshot) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    executeAction('click', { x, y });
  };

  const handleScroll = (direction: 'up' | 'down') => {
    const amount = direction === 'down' ? 3 : -3;
    executeAction('scroll', { amount });
  };

  const handleKeyPress = (key: string) => {
    executeAction('keyPress', { key });
  };

  const copyUrlToClipboard = () => {
    navigator.clipboard.writeText(currentUrl);
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed ${
        isMaximized
          ? 'inset-0'
          : 'bottom-4 right-4 w-96 h-96'
      } bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col z-50 transition-all duration-300`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-800 to-slate-900 border-b border-slate-700 rounded-t-lg">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <h2 className="text-sm font-semibold text-white">💻 El Ordenador de Zoco</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1 hover:bg-slate-700 rounded transition-colors"
            title={isMaximized ? 'Minimizar' : 'Maximizar'}
          >
            {isMaximized ? (
              <Minimize2 size={16} className="text-slate-300" />
            ) : (
              <Maximize2 size={16} className="text-slate-300" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-700 rounded transition-colors"
            title="Cerrar"
          >
            <X size={16} className="text-slate-300" />
          </button>
        </div>
      </div>

      {/* URL Bar */}
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex gap-2">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleNavigate()}
          className="flex-1 px-2 py-1 bg-slate-700 text-white text-xs rounded border border-slate-600 focus:outline-none focus:border-blue-500"
          placeholder="Introduce URL..."
        />
        <button
          onClick={handleNavigate}
          disabled={isLoading}
          className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white text-xs rounded transition-colors"
        >
          Ir
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex gap-3 p-3 overflow-hidden">
        {/* Screenshot Area */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          <div className="flex-1 bg-slate-800 border border-slate-700 rounded overflow-auto relative">
            {currentScreenshot ? (
              <div className="w-full h-full flex items-center justify-center">
                <img
                  src={`data:image/png;base64,${currentScreenshot.screenshot}`}
                  alt="Captura de pantalla del Ordenador de Zoco"
                  onClick={handleClick}
                  className="max-w-full max-h-full cursor-crosshair"
                  title="Haz clic para interactuar"
                />
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-500">
                <div className="text-center">
                  <p className="text-sm mb-2">Ninguna captura de pantalla aún</p>
                  <button
                    onClick={handleScreenshot}
                    disabled={isLoading}
                    className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-600 text-white text-xs rounded transition-colors"
                  >
                    Tomar Captura
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Control Buttons */}
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={handleScreenshot}
              disabled={isLoading}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-600 text-white text-xs rounded transition-colors flex items-center gap-1"
            >
              <RefreshCw size={12} /> Captura
            </button>
            <button
              onClick={() => handleScroll('up')}
              disabled={isLoading}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-600 text-white text-xs rounded transition-colors"
            >
              ↑ Arriba
            </button>
            <button
              onClick={() => handleScroll('down')}
              disabled={isLoading}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-600 text-white text-xs rounded transition-colors"
            >
              ↓ Abajo
            </button>
            <button
              onClick={() => handleKeyPress('enter')}
              disabled={isLoading}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-600 text-white text-xs rounded transition-colors"
            >
              Enter
            </button>
          </div>
        </div>

        {/* Logs Panel */}
        <div className="w-48 flex flex-col gap-2 min-w-0">
          <div className="text-xs font-semibold text-slate-300 px-2">Registros</div>
          <div className="flex-1 bg-slate-800 border border-slate-700 rounded overflow-y-auto text-xs font-mono">
            {logs.length === 0 ? (
              <div className="p-2 text-slate-500">Sin eventos aún...</div>
            ) : (
              <div className="p-2 space-y-1">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={`py-0.5 px-1 rounded ${
                      log.status === 'pending'
                        ? 'bg-yellow-900/30 text-yellow-300'
                        : log.status === 'success'
                        ? 'bg-green-900/30 text-green-300'
                        : 'bg-red-900/30 text-red-300'
                    }`}
                  >
                    <span className="text-slate-400">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                    <span className="font-semibold">{log.action}:</span> {log.message}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>

          {/* URL Display */}
          <div className="bg-slate-800 border border-slate-700 rounded p-2 flex gap-1">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-slate-400 mb-1">URL Actual:</div>
              <div className="text-xs text-blue-400 truncate" title={currentUrl}>
                {currentUrl}
              </div>
            </div>
            <button
              onClick={copyUrlToClipboard}
              className="p-1 hover:bg-slate-700 rounded transition-colors flex-shrink-0"
              title="Copiar URL"
            >
              <Copy size={12} className="text-slate-300" />
            </button>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="px-4 py-2 bg-slate-800 border-t border-slate-700 text-xs text-slate-400 flex justify-between">
        <span>{isLoading ? '⏳ Procesando...' : '✓ Listo'}</span>
        <span>{logs.length} eventos</span>
      </div>
    </div>
  );
};

export default OrdenadorZocoPanel;
