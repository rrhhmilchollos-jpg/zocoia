import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';
import { toast } from '../components/ui';

/* ── Tipos ── */
interface ActionResult {
  success: boolean;
  screenshot?: string | null;
  url?: string | null;
  error?: string;
}

interface LogEntry {
  id: number;
  type: 'action' | 'success' | 'error' | 'info';
  message: string;
  ts: string;
}

interface InstructionMsg {
  role: 'user' | 'assistant';
  content: string;
}

const ACTION_ICONS: Record<string, string> = {
  navigate: '🌐', click: '🖱', doubleClick: '🖱🖱', rightClick: '🖱', type: '⌨️',
  keyPress: '⌨️', drag: '✋', scroll: '↕️', moveMouse: '➡️', wait: '⏳',
  screenshot: '📸', get_url: '🔗',
};

const QUICK_ACTIONS = [
  { label: 'Screenshot', action: 'screenshot', icon: '📸' },
  { label: 'URL actual', action: 'get_url', icon: '🔗' },
  { label: 'Scroll ↓', action: 'scroll', params: { amount: 300 }, icon: '↓' },
  { label: 'Scroll ↑', action: 'scroll', params: { amount: -300 }, icon: '↑' },
  { label: 'Intro', action: 'keyPress', params: { key: 'enter' }, icon: '↵' },
  { label: 'Escape', action: 'keyPress', params: { key: 'escape' }, icon: '⎋' },
];

export default function OrdenadorZoco() {
  const { token } = useAuth();
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [navInput, setNavInput] = useState<string>('');
  const [typeInput, setTypeInput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [clickMode, setClickMode] = useState(false);
  const [instructions, setInstructions] = useState<InstructionMsg[]>([]);
  const [instructionInput, setInstructionInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [activePanel, setActivePanel] = useState<'controles' | 'instrucciones' | 'logs'>('controles');
  const [e2bConfigured, setE2bConfigured] = useState<boolean | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logIdRef = useRef(0);

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(p => [...p.slice(-99), { id: ++logIdRef.current, type, message, ts: new Date().toLocaleTimeString('es-ES') }]);
  }, []);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const authHeaders = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const callAction = useCallback(async (actionParams: Record<string, any>): Promise<ActionResult> => {
    setLoading(true);
    const icon = ACTION_ICONS[actionParams.action] || '⚡';
    addLog('action', `${icon} ${actionParams.action}${actionParams.url ? `: ${actionParams.url}` : ''}${actionParams.x !== undefined ? ` (${actionParams.x}, ${actionParams.y})` : ''}`);
    try {
      const res = await fetch(`${API_BASE}/api/ordenador-zoco`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(actionParams),
      });
      const data: ActionResult = await res.json();
      if (!res.ok || !data.success) {
        const errMsg = data.error || `HTTP ${res.status}`;
        addLog('error', `✕ ${errMsg}`);
        if (errMsg.includes('E2B_API_KEY')) {
          setE2bConfigured(false);
        }
        return data;
      }
      if (data.screenshot) setScreenshot(data.screenshot);
      if (data.url) setCurrentUrl(data.url);
      addLog('success', `✓ ${actionParams.action} completado${data.url ? ` · ${data.url}` : ''}`);
      setE2bConfigured(true);
      return data;
    } catch (e: any) {
      const msg = e.message || 'Error de red';
      addLog('error', `✕ ${msg}`);
      return { success: false, error: msg };
    } finally {
      setLoading(false);
    }
  }, [authHeaders, addLog]);

  const handleNavigate = async () => {
    if (!navInput.trim()) return;
    let url = navInput.trim();
    if (!url.startsWith('http')) url = `https://${url}`;
    await callAction({ action: 'navigate', url });
    setNavInput('');
  };

  const handleType = async () => {
    if (!typeInput.trim()) return;
    await callAction({ action: 'type', text: typeInput });
    setTypeInput('');
  };

  const handleScreenClick = useCallback(async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!clickMode || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = 1280 / rect.width;
    const scaleY = 720 / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    await callAction({ action: 'click', x, y });
  }, [clickMode, callAction]);

  const handleSendInstruction = async () => {
    const msg = instructionInput.trim();
    if (!msg || aiLoading) return;
    setInstructionInput('');
    const newMsgs: InstructionMsg[] = [...instructions, { role: 'user', content: msg }];
    setInstructions(newMsgs);
    setAiLoading(true);
    addLog('info', `🤖 Instrucción IA: "${msg.slice(0, 60)}${msg.length > 60 ? '...' : ''}"`);
    try {
      const contextMsg = `Eres el agente de control del Ordenador de Zoco. Controlas un navegador virtual real. URL actual: ${currentUrl || 'desconocida'}. El usuario te da instrucciones en lenguaje natural y tú debes traducirlas a acciones concretas del navegador. Responde SIEMPRE en español describiendo brevemente qué vas a hacer y qué acción ejecutaste.`;
      const res = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          model: 'zoco-plus',
          messages: [
            { role: 'system', content: contextMsg },
            ...newMsgs.map(m => ({ role: m.role, content: m.content })),
          ],
        }),
      });
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || 'Sin respuesta del modelo.';
      setInstructions(p => [...p, { role: 'assistant', content: reply }]);

      // Intentar extraer y ejecutar una acción si el modelo la sugiere
      const urlMatch = reply.match(/naveg\w*\s+(?:a\s+)?(?:la\s+)?(?:página\s+)?(https?:\/\/[^\s]+)/i);
      if (urlMatch) {
        await callAction({ action: 'navigate', url: urlMatch[1] });
      } else {
        await callAction({ action: 'screenshot' });
      }
    } catch (e: any) {
      setInstructions(p => [...p, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setAiLoading(false);
    }
  };

  const logColors = { action: 'text-blue-400', success: 'text-green-400', error: 'text-red-400', info: 'text-purple-400' };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🖥️ Ordenador de Zoco
          </h1>
          <p className="text-gray-500 text-xs mt-1">Escritorio virtual en la nube · Computer Use · Powered by E2B</p>
        </div>
        <div className="flex items-center gap-2">
          {e2bConfigured === false && (
            <span className="text-[11px] bg-red-950/50 border border-red-700/40 text-red-400 px-3 py-1.5 rounded-lg">
              ⚠️ E2B_API_KEY no configurada
            </span>
          )}
          {e2bConfigured === true && (
            <span className="text-[11px] bg-green-950/50 border border-green-700/40 text-green-400 px-3 py-1.5 rounded-lg">
              ● E2B conectado
            </span>
          )}
          <button
            onClick={() => callAction({ action: 'screenshot' })}
            disabled={loading}
            className="text-xs px-3 py-1.5 bg-[#252525] border border-[#333] rounded-lg text-gray-300 hover:border-[#555] disabled:opacity-40 transition-colors"
          >
            📸 Capturar
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0" style={{ height: 'calc(100vh - 220px)' }}>

        {/* ── Pantalla principal ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Barra de navegación */}
          <div className="flex gap-2 mb-3">
            <div className="flex-1 flex items-center gap-2 bg-[#1a1a1a] border border-[#333] rounded-xl px-3">
              <span className="text-gray-600 text-xs">🔒</span>
              <input
                value={navInput}
                onChange={e => setNavInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleNavigate()}
                placeholder={currentUrl || 'https://ejemplo.com'}
                className="flex-1 bg-transparent text-gray-300 text-xs py-2.5 focus:outline-none placeholder-gray-600"
              />
              {currentUrl && <span className="text-[10px] text-gray-600 truncate max-w-[120px]">{currentUrl}</span>}
            </div>
            <button
              onClick={handleNavigate}
              disabled={loading || !navInput.trim()}
              className="px-4 py-2 bg-purple-600 text-white text-xs rounded-xl hover:bg-purple-500 disabled:opacity-40 transition-colors font-medium"
            >
              Ir
            </button>
          </div>

          {/* Pantalla del escritorio */}
          <div className={`relative flex-1 bg-[#0a0a0a] border rounded-xl overflow-hidden ${clickMode ? 'border-purple-500 cursor-crosshair' : 'border-[#222]'}`}>
            {loading && (
              <div className="absolute inset-0 bg-black/40 z-10 flex items-center justify-center backdrop-blur-sm">
                <div className="flex items-center gap-3 bg-[#1a1a1a] border border-[#333] rounded-xl px-5 py-3">
                  <svg className="animate-spin w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <span className="text-xs text-gray-300">Ejecutando acción...</span>
                </div>
              </div>
            )}

            {screenshot ? (
              <img
                ref={imgRef}
                src={`data:image/png;base64,${screenshot}`}
                alt="Captura del escritorio virtual"
                className={`w-full h-full object-contain select-none ${clickMode ? 'cursor-crosshair' : 'cursor-default'}`}
                onClick={handleScreenClick}
                draggable={false}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <div className="text-6xl mb-4">🖥️</div>
                <p className="text-gray-400 font-medium mb-2">Ordenador de Zoco</p>
                <p className="text-gray-600 text-xs mb-6 max-w-xs leading-relaxed">
                  Navega a cualquier URL, controla el ratón, escribe texto y captura la pantalla en tiempo real.
                </p>
                <button
                  onClick={() => { setNavInput('https://google.com'); }}
                  className="text-xs px-4 py-2 bg-purple-600/20 border border-purple-700/40 text-purple-400 rounded-lg hover:bg-purple-600/30 transition-colors"
                >
                  Empezar con Google →
                </button>
                {e2bConfigured === false && (
                  <div className="mt-4 bg-red-950/30 border border-red-700/30 rounded-xl p-4 max-w-sm text-left">
                    <p className="text-red-400 text-xs font-medium mb-2">⚠️ E2B no configurado</p>
                    <p className="text-gray-500 text-[11px] leading-relaxed">
                      Añade tu <code className="text-gray-300">E2B_API_KEY</code> en las variables de entorno de Coolify para activar el escritorio virtual.
                    </p>
                    <a href="https://e2b.dev" target="_blank" rel="noopener noreferrer" className="text-purple-400 text-[11px] hover:underline mt-2 block">
                      Obtener clave en e2b.dev →
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Overlay de modo click */}
            {clickMode && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-purple-600/90 text-white text-[11px] px-3 py-1.5 rounded-full backdrop-blur-sm pointer-events-none">
                Modo clic activo — haz clic en la pantalla
              </div>
            )}
          </div>

          {/* Acciones rápidas */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button
              onClick={() => setClickMode(p => !p)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${clickMode ? 'bg-purple-600/30 border-purple-500 text-purple-300' : 'bg-[#1a1a1a] border-[#333] text-gray-400 hover:border-[#555]'}`}
            >
              🖱 {clickMode ? 'Modo clic ON' : 'Modo clic'}
            </button>
            {QUICK_ACTIONS.map(qa => (
              <button
                key={qa.label}
                onClick={() => callAction({ action: qa.action, ...(qa.params || {}) })}
                disabled={loading}
                className="text-xs px-3 py-1.5 bg-[#1a1a1a] border border-[#333] rounded-lg text-gray-400 hover:border-[#555] hover:text-gray-200 disabled:opacity-40 transition-colors"
              >
                {qa.icon} {qa.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Panel lateral ── */}
        <div className="w-80 shrink-0 flex flex-col">
          {/* Tabs */}
          <div className="flex gap-1 bg-[#111] p-1 rounded-lg border border-[#222] mb-3">
            {(['controles', 'instrucciones', 'logs'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActivePanel(tab)}
                className={`flex-1 py-1.5 text-[11px] font-medium rounded-md capitalize transition-colors ${activePanel === tab ? 'bg-[#2a2a2a] text-white' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {tab === 'controles' ? '🎮 Controles' : tab === 'instrucciones' ? '🤖 IA' : '📋 Logs'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* ── Controles manuales ── */}
            {activePanel === 'controles' && (
              <div className="space-y-4">
                {/* Escribir texto */}
                <div className="bg-[#1a1a1a] border border-[#222] rounded-xl p-4">
                  <p className="text-[11px] font-bold text-gray-500 uppercase mb-2">⌨️ Escribir texto</p>
                  <div className="flex gap-2">
                    <input
                      value={typeInput}
                      onChange={e => setTypeInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleType()}
                      placeholder="Texto a escribir..."
                      className="flex-1 bg-[#111] border border-[#333] rounded-lg text-gray-200 text-xs px-3 py-2 focus:outline-none focus:border-purple-500 placeholder-gray-600"
                    />
                    <button onClick={handleType} disabled={loading || !typeInput.trim()}
                      className="px-3 py-2 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-500 disabled:opacity-40">
                      ↵
                    </button>
                  </div>
                </div>

                {/* Teclas especiales */}
                <div className="bg-[#1a1a1a] border border-[#222] rounded-xl p-4">
                  <p className="text-[11px] font-bold text-gray-500 uppercase mb-2">⌨️ Teclas especiales</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { label: 'Enter', key: 'enter' }, { label: 'Tab', key: 'tab' }, { label: 'Esc', key: 'escape' },
                      { label: '←', key: 'arrowleft' }, { label: '→', key: 'arrowright' }, { label: '↑', key: 'arrowup' },
                      { label: '↓', key: 'arrowdown' }, { label: 'Back', key: 'backspace' }, { label: 'Del', key: 'delete' },
                      { label: 'Ctrl+A', key: 'ctrl+a' }, { label: 'Ctrl+C', key: 'ctrl+c' }, { label: 'Ctrl+V', key: 'ctrl+v' },
                    ].map(k => (
                      <button key={k.key} onClick={() => callAction({ action: 'keyPress', key: k.key })} disabled={loading}
                        className="py-1.5 bg-[#111] border border-[#333] rounded-lg text-gray-400 text-[10px] hover:border-[#555] hover:text-gray-200 disabled:opacity-40 transition-colors">
                        {k.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Coordenadas manuales */}
                <div className="bg-[#1a1a1a] border border-[#222] rounded-xl p-4">
                  <p className="text-[11px] font-bold text-gray-500 uppercase mb-2">🖱 Clic por coordenadas</p>
                  <p className="text-[10px] text-gray-600 mb-3">El escritorio virtual mide 1280×720px</p>
                  <CoordClickForm onSubmit={(x, y, type) => callAction({ action: type, x, y })} loading={loading} />
                </div>

                {/* Scroll */}
                <div className="bg-[#1a1a1a] border border-[#222] rounded-xl p-4">
                  <p className="text-[11px] font-bold text-gray-500 uppercase mb-2">↕️ Scroll</p>
                  <div className="flex gap-2">
                    {[[-600,'↑↑'], [-300,'↑'], [300,'↓'], [600,'↓↓']].map(([amt, label]) => (
                      <button key={label} onClick={() => callAction({ action: 'scroll', amount: amt })} disabled={loading}
                        className="flex-1 py-2 bg-[#111] border border-[#333] rounded-lg text-gray-400 text-xs hover:border-[#555] disabled:opacity-40">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Instrucciones IA ── */}
            {activePanel === 'instrucciones' && (
              <div className="flex flex-col h-full" style={{ minHeight: '400px' }}>
                <div className="flex-1 overflow-y-auto bg-[#1a1a1a] border border-[#222] rounded-xl p-3 mb-3 space-y-3">
                  {instructions.length === 0 && (
                    <div className="text-center py-8">
                      <div className="text-3xl mb-2">🤖</div>
                      <p className="text-gray-500 text-xs">Dale instrucciones en lenguaje natural</p>
                      <div className="mt-3 space-y-1.5">
                        {['Ve a google.com y busca "noticias IA"', 'Haz scroll hacia abajo', 'Haz clic en el primer resultado'].map(ex => (
                          <button key={ex} onClick={() => setInstructionInput(ex)}
                            className="block w-full text-left text-[10px] text-purple-400 hover:text-purple-300 px-2 py-1 bg-purple-950/20 rounded-lg border border-purple-800/20">
                            "{ex}"
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {instructions.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${m.role === 'user' ? 'bg-purple-600 text-white' : 'bg-[#252525] text-gray-300 border border-[#333]'}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {aiLoading && (
                    <div className="flex justify-start">
                      <div className="bg-[#252525] border border-[#333] px-3 py-2 rounded-xl text-xs text-gray-500">
                        <span className="inline-flex space-x-1">
                          <span className="animate-bounce">●</span><span className="animate-bounce" style={{ animationDelay: '0.1s' }}>●</span><span className="animate-bounce" style={{ animationDelay: '0.2s' }}>●</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    value={instructionInput}
                    onChange={e => setInstructionInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendInstruction()}
                    placeholder="Instrucción en lenguaje natural..."
                    disabled={aiLoading}
                    className="flex-1 bg-[#1a1a1a] border border-[#333] rounded-xl text-gray-200 text-xs px-3 py-2.5 focus:outline-none focus:border-purple-500 placeholder-gray-600 disabled:opacity-50"
                  />
                  <button onClick={handleSendInstruction} disabled={aiLoading || !instructionInput.trim()}
                    className="px-3 py-2 bg-purple-600 text-white text-sm rounded-xl hover:bg-purple-500 disabled:opacity-40">
                    ➤
                  </button>
                </div>
              </div>
            )}

            {/* ── Logs ── */}
            {activePanel === 'logs' && (
              <div className="bg-[#0a0a0a] border border-[#222] rounded-xl p-3 font-mono text-[10px] space-y-1" style={{ minHeight: '400px', maxHeight: '600px', overflowY: 'auto' }}>
                {logs.length === 0 && <p className="text-gray-600 text-center py-8">Sin actividad todavía</p>}
                {logs.map(l => (
                  <div key={l.id} className="flex gap-2">
                    <span className="text-gray-700 shrink-0">{l.ts}</span>
                    <span className={logColors[l.type]}>{l.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Subcomponente para clic por coordenadas ── */
function CoordClickForm({ onSubmit, loading }: { onSubmit: (x: number, y: number, type: string) => void; loading: boolean }) {
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [type, setType] = useState('click');
  const submit = () => {
    const nx = parseInt(x); const ny = parseInt(y);
    if (isNaN(nx) || isNaN(ny)) return;
    onSubmit(nx, ny, type);
    setX(''); setY('');
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input value={x} onChange={e => setX(e.target.value)} placeholder="X (0-1280)"
          className="flex-1 bg-[#111] border border-[#333] rounded-lg text-gray-300 text-xs px-2 py-1.5 focus:outline-none focus:border-purple-500 placeholder-gray-600" />
        <input value={y} onChange={e => setY(e.target.value)} placeholder="Y (0-720)"
          className="flex-1 bg-[#111] border border-[#333] rounded-lg text-gray-300 text-xs px-2 py-1.5 focus:outline-none focus:border-purple-500 placeholder-gray-600" />
      </div>
      <div className="flex gap-2">
        <select value={type} onChange={e => setType(e.target.value)}
          className="flex-1 bg-[#111] border border-[#333] rounded-lg text-gray-300 text-xs px-2 py-1.5">
          <option value="click">Clic</option>
          <option value="doubleClick">Doble clic</option>
          <option value="rightClick">Clic derecho</option>
          <option value="moveMouse">Mover ratón</option>
        </select>
        <button onClick={submit} disabled={loading || !x || !y}
          className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-500 disabled:opacity-40">
          Ejecutar
        </button>
      </div>
    </div>
  );
}
