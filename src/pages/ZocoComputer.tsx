import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, API_BASE } from '../context/AuthContext';

/* ═══════════════════════════════════════════════════════════════════════════
   El Ordenador de Zoco — interfaz tipo Manus:
   · Columna izquierda: conversación con el agente + plan de fases en vivo
   · Columna derecha: "el ordenador" — visor de acciones (terminal, editor,
     navegador, búsquedas) retransmitidas por SSE
   ═══════════════════════════════════════════════════════════════════════════ */

interface Fase { titulo: string; estado: 'pendiente' | 'en_curso' | 'completada'; }
interface Msg { role: string; content: string; created_at?: string; }
interface Evento {
  id?: number;
  type: string;
  ts?: string;
  [k: string]: any;
}
interface Task {
  id: string;
  title: string;
  status: string;
  model?: string;
  created_at?: string;
  updated_at?: string;
}

const MODEL_OPTIONS = [
  { value: 'zoco-max', label: 'Zoco Max · máxima capacidad' },
  { value: 'zoco-plus', label: 'Zoco Plus · equilibrado' },
  { value: 'zoco-flash', label: 'Zoco Flash · rápido' },
];

const EVENT_META: Record<string, { icon: string; label: string; panel: string }> = {
  task_started: { icon: 'fa-rocket', label: 'Tarea iniciada', panel: 'log' },
  thinking: { icon: 'fa-brain', label: 'Pensando…', panel: 'log' },
  plan: { icon: 'fa-list-check', label: 'Plan actualizado', panel: 'log' },
  tool_call: { icon: 'fa-wrench', label: 'Herramienta', panel: 'log' },
  terminal_start: { icon: 'fa-terminal', label: 'Terminal', panel: 'terminal' },
  terminal_output: { icon: 'fa-terminal', label: 'Terminal', panel: 'terminal' },
  file_write: { icon: 'fa-file-pen', label: 'Editor', panel: 'editor' },
  file_read: { icon: 'fa-file-lines', label: 'Lectura', panel: 'editor' },
  file_list: { icon: 'fa-folder-open', label: 'Archivos', panel: 'editor' },
  web_search: { icon: 'fa-magnifying-glass', label: 'Búsqueda web', panel: 'browser' },
  web_search_result: { icon: 'fa-magnifying-glass', label: 'Resultados', panel: 'browser' },
  browse: { icon: 'fa-globe', label: 'Navegador', panel: 'browser' },
  browse_result: { icon: 'fa-globe', label: 'Página leída', panel: 'browser' },
  assistant_message: { icon: 'fa-comment', label: 'Mensaje', panel: 'log' },
  user_message: { icon: 'fa-user', label: 'Usuario', panel: 'log' },
  finished: { icon: 'fa-flag-checkered', label: 'Completada', panel: 'log' },
  paused: { icon: 'fa-pause', label: 'Pausada', panel: 'log' },
  stopped: { icon: 'fa-stop', label: 'Detenida', panel: 'log' },
  error: { icon: 'fa-triangle-exclamation', label: 'Error', panel: 'log' },
};

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  en_curso: { text: 'En curso', cls: 'bg-blue-100 text-blue-700' },
  completada: { text: 'Completada', cls: 'bg-green-100 text-green-700' },
  pausada: { text: 'Pausada', cls: 'bg-amber-100 text-amber-700' },
  detenida: { text: 'Detenida', cls: 'bg-gray-200 text-gray-600' },
  error: { text: 'Error', cls: 'bg-red-100 text-red-700' },
  pendiente: { text: 'Pendiente', cls: 'bg-gray-100 text-gray-500' },
};

export default function ZocoComputer() {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [plan, setPlan] = useState<Fase[]>([]);
  const [events, setEvents] = useState<Evento[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('zoco-max');
  const [creating, setCreating] = useState(false);
  const [computerTab, setComputerTab] = useState<'auto' | 'terminal' | 'editor' | 'browser' | 'log'>('auto');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const esRef = useRef<EventSource | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const computerEndRef = useRef<HTMLDivElement>(null);
  const lastEventIdRef = useRef(0);

  const headers = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  /* ── Carga de tareas ── */
  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/computer/tasks`, { headers: headers() });
      if (res.ok) setTasks(await res.json());
    } catch { /* silencioso */ }
  }, [headers]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  /* ── SSE: eventos en vivo de la tarea activa ── */
  const connectStream = useCallback((taskId: string) => {
    esRef.current?.close();
    const es = new EventSource(`${API_BASE}/api/computer/tasks/${taskId}/events?token=${encodeURIComponent(token || '')}&lastEventId=${lastEventIdRef.current}`);
    es.onmessage = (e) => {
      try {
        const ev: Evento = JSON.parse(e.data);
        if (ev.id) lastEventIdRef.current = Math.max(lastEventIdRef.current, ev.id);
        setEvents(prev => [...prev.slice(-499), ev]);
        if (ev.type === 'plan' && Array.isArray(ev.fases)) setPlan(ev.fases);
        if (ev.type === 'assistant_message') setMessages(prev => [...prev, { role: 'assistant', content: ev.texto }]);
        if (ev.type === 'finished') {
          setMessages(prev => [...prev, { role: 'assistant', content: ev.resumen }]);
          setActiveTask(prev => prev ? { ...prev, status: 'completada' } : prev);
          loadTasks();
        }
        if (ev.type === 'paused') setActiveTask(prev => prev ? { ...prev, status: 'pausada' } : prev);
        if (ev.type === 'stopped') setActiveTask(prev => prev ? { ...prev, status: 'detenida' } : prev);
        if (ev.type === 'error') setActiveTask(prev => prev ? { ...prev, status: 'error' } : prev);
      } catch { /* evento malformado */ }
    };
    es.onerror = () => { /* EventSource reintenta solo */ };
    esRef.current = es;
  }, [token, loadTasks]);

  useEffect(() => () => esRef.current?.close(), []);

  /* ── Abrir una tarea existente ── */
  const openTask = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/computer/tasks/${taskId}`, { headers: headers() });
      if (!res.ok) return;
      const data = await res.json();
      setActiveTask({ id: data.id, title: data.title, status: data.status, model: data.model });
      setMessages(data.messages || []);
      setPlan(data.plan || []);
      setEvents(data.events || []);
      lastEventIdRef.current = data.events?.length ? Math.max(...data.events.map((e: Evento) => e.id || 0)) : 0;
      connectStream(taskId);
    } catch { /* silencioso */ }
  }, [headers, connectStream]);

  /* ── Crear tarea nueva ── */
  const createTask = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || creating) return;
    setCreating(true);
    setInput('');
    try {
      const res = await fetch(`${API_BASE}/api/computer/tasks`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ prompt, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear la tarea');
      setActiveTask({ id: data.id, title: data.title, status: 'en_curso', model });
      setMessages([{ role: 'user', content: prompt }]);
      setPlan([]);
      setEvents([]);
      lastEventIdRef.current = 0;
      connectStream(data.id);
      loadTasks();
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    } finally {
      setCreating(false);
    }
  }, [input, creating, model, headers, connectStream, loadTasks]);

  /* ── Enviar mensaje a la tarea activa ── */
  const sendMessage = useCallback(async () => {
    const content = input.trim();
    if (!content || !activeTask) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content }]);
    try {
      const res = await fetch(`${API_BASE}/api/computer/tasks/${activeTask.id}/messages`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ content }),
      });
      if (res.ok) setActiveTask(prev => prev ? { ...prev, status: 'en_curso' } : prev);
    } catch { /* silencioso */ }
  }, [input, activeTask, headers]);

  const stopTask = useCallback(async () => {
    if (!activeTask) return;
    await fetch(`${API_BASE}/api/computer/tasks/${activeTask.id}/stop`, { method: 'POST', headers: headers() }).catch(() => {});
    setActiveTask(prev => prev ? { ...prev, status: 'detenida' } : prev);
    loadTasks();
  }, [activeTask, headers, loadTasks]);

  const newTask = useCallback(() => {
    esRef.current?.close();
    setActiveTask(null);
    setMessages([]);
    setPlan([]);
    setEvents([]);
    setInput('');
    lastEventIdRef.current = 0;
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, plan]);
  useEffect(() => { computerEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events]);

  /* ── Eventos filtrados según pestaña del ordenador ── */
  const visibleEvents = events.filter(ev => {
    const meta = EVENT_META[ev.type];
    if (!meta) return false;
    if (computerTab === 'auto' || computerTab === 'log') return true;
    return meta.panel === computerTab;
  });

  const running = activeTask?.status === 'en_curso';
  const badge = STATUS_BADGE[activeTask?.status || 'pendiente'] || STATUS_BADGE.pendiente;

  return (
    <div className="h-screen flex bg-[#f5f5f4] text-gray-800 overflow-hidden">
      {/* ══ Barra lateral: historial de tareas ══ */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-0'} transition-all duration-200 bg-white border-r border-gray-200 flex flex-col overflow-hidden shrink-0`}>
        <div className="p-3 border-b border-gray-100 flex items-center justify-between">
          <Link to="/" className="text-sm font-semibold text-gray-700 hover:text-blue-600 flex items-center gap-2">
            <i className="fa-solid fa-arrow-left text-xs" /> Zoco IA
          </Link>
          <button onClick={newTask} className="text-xs bg-gray-900 text-white px-2.5 py-1.5 rounded-lg hover:bg-gray-700">
            <i className="fa-solid fa-plus mr-1" /> Nueva
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {tasks.length === 0 && <p className="text-xs text-gray-400 p-3">Sin tareas todavía. Crea la primera.</p>}
          {tasks.map(t => (
            <button
              key={t.id}
              onClick={() => openTask(t.id)}
              className={`w-full text-left p-2.5 rounded-lg text-xs hover:bg-gray-100 ${activeTask?.id === t.id ? 'bg-blue-50 border border-blue-200' : 'border border-transparent'}`}
            >
              <p className="font-medium text-gray-700 truncate">{t.title}</p>
              <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] ${(STATUS_BADGE[t.status] || STATUS_BADGE.pendiente).cls}`}>
                {(STATUS_BADGE[t.status] || STATUS_BADGE.pendiente).text}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* ══ Columna central: conversación + plan ══ */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0">
          <button onClick={() => setSidebarOpen(o => !o)} className="text-gray-500 hover:text-gray-800">
            <i className="fa-solid fa-bars" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gray-900 text-white flex items-center justify-center shrink-0">
              <i className="fa-solid fa-desktop text-sm" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold truncate">{activeTask ? activeTask.title : 'El Ordenador de Zoco'}</h1>
              <p className="text-[11px] text-gray-400">Agente autónomo general</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {activeTask && (
              <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${badge.cls}`}>
                {running && <i className="fa-solid fa-circle-notch fa-spin mr-1" />}
                {badge.text}
              </span>
            )}
            {running && (
              <button onClick={stopTask} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2.5 py-1.5 rounded-lg hover:bg-red-100">
                <i className="fa-solid fa-stop mr-1" /> Detener
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {!activeTask && (
            <div className="max-w-xl mx-auto mt-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-900 text-white flex items-center justify-center mx-auto mb-4">
                <i className="fa-solid fa-desktop text-2xl" />
              </div>
              <h2 className="text-xl font-bold mb-2">¿Qué quieres que haga por ti?</h2>
              <p className="text-sm text-gray-500 mb-6">
                Describe cualquier tarea: investigar un tema, escribir un informe, analizar datos,
                programar un script… El agente planifica, ejecuta herramientas reales y te entrega el resultado.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                {['Investiga las últimas tendencias de IA y escribe un informe', 'Crea un script en Python que analice un CSV', 'Busca información sobre mi competencia y resúmela'].map(s => (
                  <button key={s} onClick={() => setInput(s)} className="p-3 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 text-gray-600 text-left">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
                {m.content}
              </div>
            </div>
          ))}

          {/* Plan de fases en vivo */}
          {plan.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4 max-w-[85%]">
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                <i className="fa-solid fa-list-check mr-1.5" /> Plan de la tarea
              </p>
              <ul className="space-y-1.5">
                {plan.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    {f.estado === 'completada' && <i className="fa-solid fa-circle-check text-green-500" />}
                    {f.estado === 'en_curso' && <i className="fa-solid fa-circle-notch fa-spin text-blue-500" />}
                    {f.estado === 'pendiente' && <i className="fa-regular fa-circle text-gray-300" />}
                    <span className={f.estado === 'completada' ? 'text-gray-400 line-through' : f.estado === 'en_curso' ? 'font-medium' : 'text-gray-500'}>
                      {f.titulo}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {running && (
            <div className="flex items-center gap-2 text-xs text-gray-400 pl-2">
              <i className="fa-solid fa-circle-notch fa-spin" /> El agente está trabajando…
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Entrada */}
        <div className="p-3 bg-white border-t border-gray-200 shrink-0">
          <div className="flex items-end gap-2 max-w-3xl mx-auto">
            {!activeTask && (
              <select value={model} onChange={e => setModel(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-2.5 bg-gray-50 text-gray-600 shrink-0">
                {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); activeTask ? sendMessage() : createTask(); } }}
              placeholder={activeTask ? 'Envía instrucciones adicionales al agente…' : 'Describe la tarea que quieres delegar…'}
              rows={1}
              className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
            />
            <button
              onClick={activeTask ? sendMessage : createTask}
              disabled={creating || !input.trim()}
              className="bg-gray-900 text-white w-10 h-10 rounded-xl flex items-center justify-center hover:bg-gray-700 disabled:opacity-40 shrink-0"
            >
              <i className={`fa-solid ${creating ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'} text-sm`} />
            </button>
          </div>
        </div>
      </main>

      {/* ══ Columna derecha: el ordenador (visor de acciones) ══ */}
      <section className="w-[46%] max-w-3xl bg-[#1c1c1e] text-gray-200 flex flex-col border-l border-gray-800 shrink-0 hidden lg:flex">
        <div className="h-14 flex items-center px-4 gap-3 border-b border-gray-800 shrink-0">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/80" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <span className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <p className="text-xs font-medium text-gray-400">Ordenador de Zoco</p>
          <div className="ml-auto flex gap-1 text-[11px]">
            {([['auto', 'Todo'], ['terminal', 'Terminal'], ['editor', 'Editor'], ['browser', 'Navegador']] as const).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setComputerTab(tab)}
                className={`px-2.5 py-1 rounded-md ${computerTab === tab ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-xs">
          {visibleEvents.length === 0 && (
            <div className="text-gray-600 text-center mt-20">
              <i className="fa-solid fa-display text-3xl mb-3 block" />
              Las acciones del agente aparecerán aquí en tiempo real.
            </div>
          )}
          {visibleEvents.map((ev, i) => {
            const meta = EVENT_META[ev.type] || { icon: 'fa-circle-info', label: ev.type, panel: 'log' };
            return (
              <div key={ev.id ?? `live-${i}`} className="bg-[#242426] border border-gray-800 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#2c2c2e] text-[11px] text-gray-400">
                  <i className={`fa-solid ${meta.icon}`} />
                  <span className="font-semibold">{meta.label}</span>
                  {ev.ts && <span className="ml-auto text-gray-600">{new Date(ev.ts).toLocaleTimeString('es-ES')}</span>}
                </div>
                <div className="px-3 py-2 whitespace-pre-wrap break-words text-gray-300">
                  {ev.type === 'terminal_start' && <span className="text-green-400">$ {ev.comando}</span>}
                  {ev.type === 'terminal_output' && (
                    <>
                      <span className="text-green-400">$ {ev.comando}</span>
                      {'\n'}
                      <span className={ev.exitCode === 0 ? 'text-gray-300' : 'text-red-400'}>{ev.salida}</span>
                    </>
                  )}
                  {ev.type === 'file_write' && (
                    <>
                      <span className="text-blue-400">✏ {ev.ruta}</span>
                      {'\n'}
                      <span className="text-gray-400">{ev.contenido}</span>
                    </>
                  )}
                  {ev.type === 'file_read' && <span className="text-blue-300">📄 Leyendo {ev.ruta}</span>}
                  {ev.type === 'file_list' && <span className="text-blue-300">📁 Listando workspace ({ev.total} elementos)</span>}
                  {ev.type === 'web_search' && <span className="text-purple-300">🔍 {ev.consulta}</span>}
                  {ev.type === 'web_search_result' && <span className="text-gray-400">{ev.resultado}</span>}
                  {ev.type === 'browse' && <span className="text-cyan-300">🌐 {ev.url}</span>}
                  {ev.type === 'browse_result' && <span className="text-gray-400">{ev.error ? `✕ ${ev.error}` : ev.extracto}</span>}
                  {ev.type === 'plan' && Array.isArray(ev.fases) && (
                    <span className="text-amber-300">
                      {ev.fases.map((f: Fase, j: number) => `${f.estado === 'completada' ? '✓' : f.estado === 'en_curso' ? '▶' : '○'} ${f.titulo}`).join('\n')}
                    </span>
                  )}
                  {ev.type === 'tool_call' && <span className="text-gray-400">{ev.herramienta}({ev.argumentos})</span>}
                  {ev.type === 'thinking' && <span className="text-gray-500 italic">Iteración {ev.iteracion}: analizando estado y decidiendo siguiente acción…</span>}
                  {ev.type === 'assistant_message' && <span className="text-emerald-300">{ev.texto}</span>}
                  {ev.type === 'user_message' && <span className="text-gray-300">{ev.texto}</span>}
                  {ev.type === 'finished' && <span className="text-green-400">✓ Tarea completada{Array.isArray(ev.archivos) && ev.archivos.length ? `\nArchivos: ${ev.archivos.join(', ')}` : ''}</span>}
                  {ev.type === 'error' && <span className="text-red-400">✕ {ev.mensaje}</span>}
                  {ev.type === 'paused' && <span className="text-amber-400">⏸ {ev.mensaje}</span>}
                  {ev.type === 'stopped' && <span className="text-gray-500">■ Tarea detenida por el usuario</span>}
                  {ev.type === 'task_started' && <span className="text-gray-400">▶ {ev.titulo}</span>}
                </div>
              </div>
            );
          })}
          <div ref={computerEndRef} />
        </div>
      </section>
    </div>
  );
}
