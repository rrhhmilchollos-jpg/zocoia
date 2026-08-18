import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, API_BASE } from '../context/AuthContext';

interface Fase { titulo: string; estado: 'pendiente' | 'en_curso' | 'completada'; }
interface Msg { role: string; content: string; created_at?: string; }
interface Evento { id?: number; type: string; ts?: string; [key: string]: any; }
interface RuntimeState { phase?: string; iteration?: number; active_tool?: string | null; tool_run_id?: string; channel?: string; status_detail?: string; elapsed_seconds?: number; provider?: string; model?: string; last_progress_at?: string; [key: string]: any; }
interface Task { id: string; title: string; status: string; model?: string; runtime_state?: string; runtime?: RuntimeState; created_at?: string; updated_at?: string; }

type RuntimeTab = 'all' | 'terminal' | 'files' | 'web' | 'activity';

// Las peticiones convencionales pueden pasar por el proxy web. El stream SSE
// se conecta al servicio persistente para conservar el envío inmediato de cada
// evento y evitar buffering intermedio en despliegues estáticos.
const SSE_API_BASE = import.meta.env.VITE_SSE_API_URL || 'https://api.zocoia.es';

const MODEL_OPTIONS = [
  { value: 'zoco-max', label: 'Zoco Max', description: 'Razonamiento ampliado' },
  { value: 'zoco-plus', label: 'Zoco Plus', description: 'Equilibrado' },
  { value: 'zoco-flash', label: 'Zoco Flash', description: 'Respuesta rápida' },
];

const EVENT_META: Record<string, { icon: string; label: string; panel: RuntimeTab; tone: string }> = {
  task_queued: { icon: 'fa-clock', label: 'Tarea en cola', panel: 'activity', tone: 'text-slate-300' },
  task_started: { icon: 'fa-play', label: 'Ejecución iniciada', panel: 'activity', tone: 'text-emerald-300' },
  runtime_snapshot: { icon: 'fa-gauge-high', label: 'Estado recuperado', panel: 'activity', tone: 'text-cyan-300' },
  runtime_state: { icon: 'fa-satellite-dish', label: 'Estado operativo', panel: 'activity', tone: 'text-cyan-300' },
  tool_started: { icon: 'fa-spinner', label: 'Herramienta iniciada', panel: 'activity', tone: 'text-amber-300' },
  tool_progress: { icon: 'fa-spinner fa-spin', label: 'Herramienta en curso', panel: 'terminal', tone: 'text-amber-300' },
  tool_completed: { icon: 'fa-circle-check', label: 'Herramienta finalizada', panel: 'activity', tone: 'text-emerald-300' },
  tool_cancelled: { icon: 'fa-ban', label: 'Cancelación solicitada', panel: 'activity', tone: 'text-amber-300' },
  thinking: { icon: 'fa-sparkles', label: 'Razonando', panel: 'activity', tone: 'text-violet-300' },
  model_waiting: { icon: 'fa-microchip', label: 'Modelo local activo', panel: 'activity', tone: 'text-cyan-300' },
  plan: { icon: 'fa-diagram-project', label: 'Plan actualizado', panel: 'activity', tone: 'text-sky-300' },
  plan_updated: { icon: 'fa-diagram-project', label: 'Plan actualizado', panel: 'activity', tone: 'text-sky-300' },
  tool_call: { icon: 'fa-wand-magic-sparkles', label: 'Herramienta', panel: 'activity', tone: 'text-amber-300' },
  tool_result: { icon: 'fa-terminal', label: 'Resultado', panel: 'terminal', tone: 'text-emerald-300' },
  terminal_start: { icon: 'fa-terminal', label: 'Terminal iniciada', panel: 'terminal', tone: 'text-emerald-300' },
  terminal_output: { icon: 'fa-terminal', label: 'Salida en vivo', panel: 'terminal', tone: 'text-emerald-300' },
  file_write: { icon: 'fa-file-circle-plus', label: 'Archivo creado', panel: 'files', tone: 'text-sky-300' },
  file_edit: { icon: 'fa-file-pen', label: 'Archivo actualizado', panel: 'files', tone: 'text-sky-300' },
  file_read: { icon: 'fa-file-lines', label: 'Archivo leído', panel: 'files', tone: 'text-sky-300' },
  file_list: { icon: 'fa-folder-tree', label: 'Workspace', panel: 'files', tone: 'text-sky-300' },
  web_search: { icon: 'fa-magnifying-glass', label: 'Búsqueda', panel: 'web', tone: 'text-fuchsia-300' },
  web_search_result: { icon: 'fa-magnifying-glass', label: 'Resultados', panel: 'web', tone: 'text-fuchsia-300' },
  web_read: { icon: 'fa-book-open', label: 'Página revisada', panel: 'web', tone: 'text-fuchsia-300' },
  browse: { icon: 'fa-globe', label: 'Navegador', panel: 'web', tone: 'text-fuchsia-300' },
  browse_result: { icon: 'fa-globe', label: 'Página revisada', panel: 'web', tone: 'text-fuchsia-300' },
  browser_action_start: { icon: 'fa-hourglass-start', label: 'Acción web iniciada', panel: 'web', tone: 'text-fuchsia-300' },
  browser_action_done: { icon: 'fa-circle-check', label: 'Acción web completada', panel: 'web', tone: 'text-fuchsia-300' },
  browser_action: { icon: 'fa-arrow-pointer', label: 'Acción web', panel: 'web', tone: 'text-fuchsia-300' },
  browser_screenshot: { icon: 'fa-camera', label: 'Captura web', panel: 'web', tone: 'text-fuchsia-300' },
  port_exposed: { icon: 'fa-link', label: 'Servicio publicado', panel: 'activity', tone: 'text-emerald-300' },
  assistant_message: { icon: 'fa-comment-dots', label: 'Respuesta', panel: 'activity', tone: 'text-slate-300' },
  user_message: { icon: 'fa-user', label: 'Instrucción', panel: 'activity', tone: 'text-slate-300' },
  strategy_recovery: { icon: 'fa-route', label: 'Cambio de estrategia', panel: 'activity', tone: 'text-cyan-300' },
  tool_rejected: { icon: 'fa-shield-halved', label: 'Repetición bloqueada', panel: 'activity', tone: 'text-orange-300' },
  tool_error: { icon: 'fa-triangle-exclamation', label: 'Herramienta con error', panel: 'activity', tone: 'text-red-300' },
  finished: { icon: 'fa-circle-check', label: 'Resultado entregado', panel: 'activity', tone: 'text-emerald-300' },
  paused: { icon: 'fa-circle-pause', label: 'Ejecución pausada', panel: 'activity', tone: 'text-amber-300' },
  stopped: { icon: 'fa-circle-stop', label: 'Ejecución detenida', panel: 'activity', tone: 'text-slate-400' },
  error: { icon: 'fa-circle-xmark', label: 'Error de ejecución', panel: 'activity', tone: 'text-red-300' },
};

// El backend transmite eventos SSE con `event: <tipo>`. EventSource solo invoca
// `onmessage` para el tipo por defecto, por lo que se registran también todos los
// tipos nombrados que el runtime puede emitir.
const SSE_EVENT_TYPES = [
  ...Object.keys(EVENT_META),
  'sandbox_started', 'sandbox_unavailable', 'sandbox_command', 'sandbox_error',
  'todo_recited', 'task_resumed', 'task_stopped', 'browser_action_success', 'browser_action_error',
];

const STATUS_META: Record<string, { text: string; className: string; dot: string }> = {
  en_curso: { text: 'En curso', className: 'border-violet-400/25 bg-violet-400/10 text-violet-200', dot: 'bg-violet-300 animate-pulse' },
  completada: { text: 'Completada', className: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200', dot: 'bg-emerald-300' },
  pausada: { text: 'Pausada', className: 'border-amber-400/25 bg-amber-400/10 text-amber-200', dot: 'bg-amber-300' },
  detenida: { text: 'Detenida', className: 'border-slate-500/35 bg-slate-500/10 text-slate-300', dot: 'bg-slate-400' },
  error: { text: 'Error', className: 'border-red-400/25 bg-red-400/10 text-red-200', dot: 'bg-red-300' },
  pendiente: { text: 'Pendiente', className: 'border-slate-500/35 bg-slate-500/10 text-slate-300', dot: 'bg-slate-400' },
};

function eventSummary(event: Evento): string {
  if (event.type === 'runtime_snapshot' || event.type === 'runtime_state') return event.runtime?.status_detail || event.status_detail || 'Estado operativo sincronizado.';
  if (event.type === 'tool_started') return `${event.herramienta || 'Herramienta'} iniciada${event.tool_run_id ? ` · ${event.tool_run_id.slice(0, 8)}` : ''}.`;
  if (event.type === 'tool_progress') return event.mensaje || `${event.herramienta || 'Herramienta'} en curso (${event.segundos || 0}s).`;
  if (event.type === 'tool_completed') return event.resumen || `${event.herramienta || 'Herramienta'} finalizada.`;
  if (event.type === 'tool_cancelled') return event.mensaje || 'Cancelación solicitada.';
  if (event.type === 'thinking') return event.texto || `Iteración ${event.iteracion || 'actual'}: preparando la siguiente acción.`;
  if (event.type === 'model_waiting') return event.mensaje || `El modelo local continúa activo (${event.segundos || 0}s).`;
  if (event.type === 'tool_call') return `${event.herramienta || 'herramienta'} · ${event.argumentos || 'sin argumentos visibles'}`;
  if (event.type === 'tool_result') return event.salida || '(herramienta terminada sin salida)';
  if (event.type === 'terminal_start') return `${event.comando ? `$ ${event.comando}` : 'Iniciando terminal…'}${event.directorio ? `\nDirectorio: ${event.directorio}` : ''}`;
  if (event.type === 'terminal_output') return event.salida || '(sin salida nueva)';
  if (event.type === 'plan' || event.type === 'plan_updated') return Array.isArray(event.fases) ? `${event.fases.length} fases sincronizadas.` : 'Plan sincronizado.';
  if (event.type === 'strategy_recovery') return `El agente revisa el último resultado de ${event.herramienta || 'la herramienta'} antes de continuar.`;
  if (event.type === 'tool_rejected' || event.type === 'tool_error' || event.type === 'paused' || event.type === 'error') return event.mensaje || 'Se requiere una estrategia distinta.';
  if (event.type === 'finished') return event.resumen || 'Resultado listo.';
  if (event.type === 'file_write' || event.type === 'file_edit' || event.type === 'file_read') return event.ruta || 'Archivo procesado.';
  if (event.type === 'web_search') return event.consulta || 'Búsqueda ejecutada.';
  if (event.type === 'browse' || event.type === 'browser_action' || event.type === 'browser_action_start' || event.type === 'browser_action_done') {
    return event.texto || event.url || event.accion || 'Acción de navegador ejecutada.';
  }
  return event.texto || event.resultado || event.mensaje || 'Evento registrado.';
}

function eventTime(event: Evento): string {
  const timestamp = event.ts || event.created_at;
  if (!timestamp) return 'Ahora';
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? 'Ahora' : date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ZocoComputer() {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [plan, setPlan] = useState<Fase[]>([]);
  const [events, setEvents] = useState<Evento[]>([]);
  const [runtime, setRuntime] = useState<RuntimeState | null>(null);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('zoco-max');
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [runtimeTab, setRuntimeTab] = useState<RuntimeTab>('all');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showTaskRail, setShowTaskRail] = useState(true);
  const [taskMenuId, setTaskMenuId] = useState<string | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const runtimeEndRef = useRef<HTMLDivElement>(null);
  const lastEventIdRef = useRef(0);

  const headers = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const loadTasks = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/computer/tasks`, { headers: headers() });
      if (response.ok) setTasks(await response.json());
    } catch { /* La pantalla conserva la última lista disponible. */ }
  }, [headers]);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  const connectStream = useCallback((taskId: string) => {
    eventSourceRef.current?.close();
    const stream = new EventSource(`${SSE_API_BASE}/api/computer/tasks/${taskId}/events?token=${encodeURIComponent(token || '')}&lastEventId=${lastEventIdRef.current}`);
    const ingestEvent = (raw: MessageEvent<string>) => {
      try {
        const event: Evento = JSON.parse(raw.data);
        const sequence = Number.parseInt(raw.lastEventId || '0', 10);
        if (sequence) lastEventIdRef.current = Math.max(lastEventIdRef.current, sequence);
        if (event.type === 'runtime_snapshot') {
          setRuntime(event.runtime || null);
          if (event.status) setActiveTask(previous => previous ? { ...previous, status: event.status } : previous);
        }
        if (event.type === 'runtime_state' && event.runtime) setRuntime(event.runtime);
        setEvents(previous => [...previous.slice(-499), { ...event, id: sequence || event.id }]);
        if ((event.type === 'plan_updated' || event.type === 'plan') && Array.isArray(event.fases)) setPlan(event.fases);
        if (event.type === 'assistant_message') setMessages(previous => [...previous, { role: 'assistant', content: event.texto || event.mensaje || '' }]);
        if (event.type === 'finished') {
          setMessages(previous => [...previous, { role: 'assistant', content: event.resumen || 'Resultado listo.' }]);
          setActiveTask(previous => previous ? { ...previous, status: 'completada' } : previous);
          void loadTasks();
        }
        if (event.type === 'paused') setActiveTask(previous => previous ? { ...previous, status: 'pausada' } : previous);
        if (event.type === 'stopped') {
          setActiveTask(previous => previous ? { ...previous, status: 'detenida' } : previous);
          setRuntime(previous => ({ ...(previous || {}), phase: 'stopped', active_tool: null, status_detail: event.mensaje || 'Tarea detenida.' }));
        }
        if (event.type === 'error') setActiveTask(previous => previous ? { ...previous, status: 'error' } : previous);
      } catch { /* Un evento malformado no interrumpe el stream. */ }
    };
    // `onmessage` conserva compatibilidad con eventos sin nombre. El servidor
    // utiliza además `event: thinking`, `event: tool_call`, etc.; esos tipos se
    // escuchan explícitamente para que la actividad sea visible sin recargar.
    stream.onmessage = ingestEvent;
    const namedEventHandler = (raw: Event) => ingestEvent(raw as MessageEvent<string>);
    SSE_EVENT_TYPES.forEach(type => stream.addEventListener(type, namedEventHandler));
    stream.onerror = () => { /* EventSource realiza la reconexión. */ };
    eventSourceRef.current = stream;
  }, [loadTasks, token]);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  const openTask = useCallback(async (taskId: string) => {
    try {
      const [response, runtimeResponse] = await Promise.all([
        fetch(`${API_BASE}/api/computer/tasks/${taskId}`, { headers: headers() }),
        fetch(`${API_BASE}/api/computer/tasks/${taskId}/runtime`, { headers: headers() }),
      ]);
      if (!response.ok) return;
      const data = await response.json();
      const snapshot = runtimeResponse.ok ? await runtimeResponse.json() : null;
      setActiveTask({ id: data.id, title: data.title, status: data.status, model: data.model, runtime: snapshot?.runtime || data.runtime });
      setRuntime(snapshot?.runtime || data.runtime || null);
      setMessages(data.messages || data.mensajes || []);
      setPlan(data.plan || []);
      const loadedEvents = data.events || data.eventos || [];
      setEvents(loadedEvents);
      lastEventIdRef.current = snapshot?.last_event_id || (loadedEvents.length ? Math.max(...loadedEvents.map((event: Evento & { seq?: number }) => event.seq || event.id || 0)) : 0);
      connectStream(taskId);
    } catch { /* Se mantiene el estado de la tarea anterior. */ }
  }, [connectStream, headers]);

  const retryTask = useCallback(async (taskId: string) => {
    setTaskActionError(null);
    try {
      const response = await fetch(`${API_BASE}/api/computer/tasks/${taskId}/retry`, { method: 'POST', headers: headers() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo reintentar la tarea.');
      setTaskMenuId(null);
      await loadTasks();
      await openTask(taskId);
    } catch (error: any) {
      setTaskActionError(error.message || 'No se pudo reintentar la tarea.');
    }
  }, [headers, loadTasks, openTask]);

  const deleteTask = useCallback(async (task: Task) => {
    if (!window.confirm(`¿Eliminar definitivamente el trabajo «${task.title}» y su historial?`)) return;
    setTaskActionError(null);
    try {
      const response = await fetch(`${API_BASE}/api/computer/tasks/${task.id}`, { method: 'DELETE', headers: headers() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo eliminar la tarea.');
      setTaskMenuId(null);
      if (activeTask?.id === task.id) {
        eventSourceRef.current?.close();
        setActiveTask(null);
        setMessages([]);
        setPlan([]);
        setEvents([]);
        setRuntime(null);
        setInput('');
        lastEventIdRef.current = 0;
      }
      await loadTasks();
    } catch (error: any) {
      setTaskActionError(error.message || 'No se pudo eliminar la tarea.');
    }
  }, [activeTask?.id, headers, loadTasks]);

  const createTask = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || creating) return;
    setCreating(true);
    setCreationError(null);
    setInput('');
    try {
      if (!token) throw new Error('Inicia sesión para crear una tarea autónoma.');
      const response = await fetch(`${API_BASE}/api/computer/tasks`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ prompt, model }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo iniciar la tarea');
      setActiveTask({ id: data.id, title: data.title, status: 'en_curso', model });
      setMessages([{ role: 'user', content: prompt }]);
      setPlan([]);
      setEvents([]);
      setRuntime(null);
      lastEventIdRef.current = 0;
      connectStream(data.id);
      void loadTasks();
    } catch (error: any) {
      setCreationError(error.message || 'No se pudo iniciar la tarea.');
      setMessages(previous => [...previous, { role: 'assistant', content: `No se pudo iniciar la tarea: ${error.message}` }]);
    } finally {
      setCreating(false);
    }
  }, [connectStream, creating, headers, input, loadTasks, model, token]);

  const sendMessage = useCallback(async (contentOverride?: string) => {
    const content = (contentOverride ?? input).trim();
    if (!content || !activeTask) return;
    setInput('');
    setMessages(previous => [...previous, { role: 'user', content }]);
    try {
      const response = await fetch(`${API_BASE}/api/computer/tasks/${activeTask.id}/messages`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ content }),
      });
      if (response.ok) {
        setActiveTask(previous => previous ? { ...previous, status: 'en_curso' } : previous);
        void loadTasks();
      }
    } catch { /* El mensaje permanece visible para conservar contexto. */ }
  }, [activeTask, headers, input, loadTasks]);

  const stopTask = useCallback(async () => {
    if (!activeTask) return;
    await fetch(`${API_BASE}/api/computer/tasks/${activeTask.id}/stop`, { method: 'POST', headers: headers() }).catch(() => undefined);
    setActiveTask(previous => previous ? { ...previous, status: 'detenida' } : previous);
    setRuntime(previous => ({ ...(previous || {}), phase: 'cancelling', active_tool: null, status_detail: 'Cancelación solicitada; liberando recursos.' }));
    void loadTasks();
  }, [activeTask, headers, loadTasks]);

  const startNewTask = useCallback(() => {
    eventSourceRef.current?.close();
    setActiveTask(null);
    setMessages([]);
    setPlan([]);
    setEvents([]);
    setRuntime(null);
    setInput('');
    lastEventIdRef.current = 0;
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, plan]);
  useEffect(() => { runtimeEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events]);

  const running = activeTask?.status === 'en_curso';
  const status = STATUS_META[activeTask?.status || 'pendiente'] || STATUS_META.pendiente;
  const eventPanel = (event: Evento): RuntimeTab => event.channel === 'terminal' ? 'terminal' : event.channel === 'files' ? 'files' : event.channel === 'web' ? 'web' : (EVENT_META[event.type]?.panel || 'activity');
  const visibleEvents = events.filter(event => runtimeTab === 'all' || eventPanel(event) === runtimeTab || (runtimeTab === 'activity' && eventPanel(event) === 'activity'));
  const activityEvents = events.filter(event => eventPanel(event) === 'activity').slice(-8);
  const currentModel = MODEL_OPTIONS.find(option => option.value === (activeTask?.model || model)) || MODEL_OPTIONS[0];
  const runtimeDescription = runtime?.status_detail || (running ? 'El agente está coordinando el plan y las herramientas.' : activeTask?.status === 'pausada' ? 'La ejecución conserva el contexto y puede reanudarse con una estrategia distinta.' : 'Consulta la actividad, el plan y los resultados de esta tarea.');
  const runtimeMeta = runtime?.active_tool ? `Herramienta: ${runtime.active_tool}` : runtime?.phase ? `Fase: ${runtime.phase}` : null;

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#0b0d12] text-[#edf0f7] selection:bg-violet-400/30">
      <div className="flex h-full min-w-[980px]">
        <aside className={`${sidebarOpen ? 'w-[270px]' : 'w-0'} relative flex shrink-0 flex-col overflow-hidden border-r border-white/[.08] bg-[#101218] transition-all duration-300`}>
          <div className="flex h-16 items-center justify-between border-b border-white/[.08] px-4">
            <Link to="/" className="flex items-center gap-2 text-sm font-bold tracking-[-.02em] text-white"><span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-400 to-sky-300 text-xs text-[#12131a]"><i className="fa-solid fa-bolt" /></span>Zoco IA</Link>
            <button onClick={startNewTask} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#11131a] transition hover:bg-violet-100"><i className="fa-solid fa-plus mr-1.5" />Nueva</button>
          </div>
          <div className="flex items-center gap-2 px-4 pt-4 text-[10px] font-bold tracking-[.16em] text-slate-500"><span>ESPACIO DE TRABAJO</span><span className="h-px flex-1 bg-white/[.07]" /></div>
          <div className="px-3 pb-4 pt-3">
            <button onClick={() => setShowTaskRail(value => !value)} className="flex w-full items-center justify-between rounded-xl border border-white/[.08] bg-white/[.035] px-3 py-2.5 text-left text-xs text-slate-300 hover:bg-white/[.07]"><span className="flex items-center gap-2"><i className="fa-solid fa-layer-group text-violet-300" />Tareas autónomas</span><span className="rounded-md bg-white/[.07] px-1.5 py-0.5 text-[10px]">{tasks.length}</span></button>
          </div>
          {showTaskRail && <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"><p className="mb-2 px-2 text-[10px] font-bold tracking-[.14em] text-slate-500">EJECUCIONES RECIENTES</p>{taskActionError && <p role="alert" className="mb-2 rounded-lg border border-red-400/25 bg-red-400/10 px-2 py-1.5 text-[10px] leading-4 text-red-200">{taskActionError}</p>}<div className="space-y-1.5">{tasks.length ? tasks.map(task => { const taskStatus = STATUS_META[task.status] || STATUS_META.pendiente; const terminal = task.status !== 'en_curso'; const retryable = ['error', 'pausada', 'detenida'].includes(task.status); return <div key={task.id} className={`relative rounded-xl border p-3 transition ${activeTask?.id === task.id ? 'border-violet-400/35 bg-violet-400/[.12] shadow-[0_8px_28px_rgba(89,76,255,.12)]' : 'border-transparent bg-white/[.018] hover:border-white/[.08] hover:bg-white/[.055]'}`}><button onClick={() => void openTask(task.id)} className="w-full pr-6 text-left"><div className="flex items-start gap-2"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${taskStatus.dot}`} /><span className="line-clamp-2 flex-1 text-xs font-semibold leading-5 text-slate-100">{task.title}</span></div><span className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-bold ${taskStatus.className}`}>{taskStatus.text}</span></button>{terminal && <><button aria-label={`Opciones para ${task.title}`} onClick={(event) => { event.stopPropagation(); setTaskMenuId(current => current === task.id ? null : task.id); }} className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-white/[.12] hover:text-white"><i className="fa-solid fa-ellipsis" /></button>{taskMenuId === task.id && <div className="absolute right-2 top-9 z-30 min-w-36 rounded-xl border border-white/[.12] bg-[#1b1e27] p-1.5 shadow-2xl"><button onClick={(event) => { event.stopPropagation(); void openTask(task.id); setTaskMenuId(null); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-slate-200 hover:bg-white/[.08]"><i className="fa-solid fa-eye w-3 text-slate-400" />Ver detalle</button>{retryable && <button onClick={(event) => { event.stopPropagation(); void retryTask(task.id); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cyan-200 hover:bg-cyan-400/10"><i className="fa-solid fa-rotate-right w-3" />Reintentar</button>}<button onClick={(event) => { event.stopPropagation(); void deleteTask(task); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-red-200 hover:bg-red-400/10"><i className="fa-solid fa-trash w-3" />Eliminar</button></div>}</>}</div>; }) : <p className="rounded-xl border border-dashed border-white/[.09] px-3 py-5 text-center text-xs leading-5 text-slate-500">Crea una tarea para iniciar tu primer flujo autónomo.</p>}</div></div>}
          <div className="border-t border-white/[.08] p-4"><div className="rounded-xl bg-white/[.035] p-3"><p className="text-xs font-semibold text-slate-300">Ordenador disponible</p><p className="mt-1 text-[11px] leading-4 text-slate-500">Terminal, archivos y navegador se muestran durante la ejecución.</p></div></div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-[#f7f8fb] text-[#171923]">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#e4e6ec] bg-white px-4">
            <button onClick={() => setSidebarOpen(value => !value)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><i className="fa-solid fa-bars" /></button>
            <div className="min-w-0"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-[#171923] text-xs text-white"><i className="fa-solid fa-robot" /></span><h1 className="truncate text-sm font-bold">{activeTask?.title || 'Agente autónomo Zoco'}</h1></div><p className="ml-9 mt-0.5 text-[11px] text-slate-400">{currentModel.label} · {currentModel.description}</p></div>
            <div className="ml-auto flex items-center gap-2">{activeTask && <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${status.className}`}><span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.text}</span>}{running && <button onClick={() => void stopTask()} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100"><i className="fa-solid fa-stop mr-1.5" />Detener</button>}</div>
          </header>

          <section className="min-h-0 flex-1 overflow-y-auto px-5 py-5 xl:px-8">
            {!activeTask && <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center pb-20 text-center"><div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#1c2151] to-[#725cff] text-2xl text-white shadow-[0_18px_45px_rgba(82,71,211,.3)]"><i className="fa-solid fa-wand-magic-sparkles" /></div><h2 className="mt-6 text-3xl font-bold tracking-[-.055em]">Delega un objetivo completo.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">Zoco convierte tu petición en un plan, usa herramientas reales y mantiene visible cada decisión en el espacio de trabajo.</p>{creationError && <p role="alert" className="mt-4 max-w-xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{creationError}</p>}<div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-3">{['Investiga el mercado y prepara un informe con fuentes.', 'Analiza los archivos del workspace y resume los hallazgos.', 'Crea una aplicación y valida los pasos principales.'].map(suggestion => <button key={suggestion} onClick={() => setInput(suggestion)} className="rounded-2xl border border-[#e5e7ef] bg-white p-4 text-xs leading-5 text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md">{suggestion}<i className="fa-solid fa-arrow-up-right-from-square ml-2 text-violet-500" /></button>)}</div></div>}
            {activeTask && <div className="mx-auto max-w-3xl space-y-5"><div className="rounded-2xl border border-[#e2e5ed] bg-white p-5 shadow-[0_8px_30px_rgba(16,24,40,.04)]"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold tracking-[.14em] text-violet-600">EJECUCIÓN ACTUAL</p><p className="mt-2 text-sm leading-6 text-slate-500">{runtimeDescription}</p>{runtimeMeta && <p className="mt-2 inline-flex rounded-lg bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">{runtimeMeta}{runtime?.elapsed_seconds ? ` · ${runtime.elapsed_seconds}s` : ''}</p>}</div>{activeTask.status === 'pausada' && <button onClick={() => void sendMessage('Reanuda la tarea revisando el último resultado. Cambia de estrategia o herramienta; no repitas la misma llamada con los mismos argumentos.')} className="rounded-xl bg-[#171923] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#2b2e3c]"><i className="fa-solid fa-rotate-right mr-1.5" />Reanudar con otra estrategia</button>}</div></div>
              {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.role === 'user' ? 'bg-[#171923] text-white' : 'border border-[#e3e5eb] bg-white text-slate-700'}`}>{message.content}</div></div>)}
              {plan.length > 0 && <section className="rounded-2xl border border-[#e3e5eb] bg-white p-5"><div className="flex items-center justify-between"><p className="text-xs font-bold tracking-[.14em] text-slate-500"><i className="fa-solid fa-diagram-project mr-2 text-violet-500" />PLAN VIVO</p><span className="text-[10px] font-semibold text-slate-400">{plan.filter(phase => phase.estado === 'completada').length}/{plan.length} completadas</span></div><ol className="mt-4 space-y-3">{plan.map((phase, index) => <li key={`${phase.titulo}-${index}`} className="flex items-center gap-3"><span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${phase.estado === 'completada' ? 'bg-emerald-100 text-emerald-700' : phase.estado === 'en_curso' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>{phase.estado === 'completada' ? <i className="fa-solid fa-check" /> : phase.estado === 'en_curso' ? <i className="fa-solid fa-spinner fa-spin" /> : index + 1}</span><span className={`text-sm ${phase.estado === 'completada' ? 'text-slate-400 line-through' : phase.estado === 'en_curso' ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>{phase.titulo}</span></li>)}</ol></section>}
              {activityEvents.length > 0 && <section className="rounded-2xl border border-[#e3e5eb] bg-white p-5"><p className="text-xs font-bold tracking-[.14em] text-slate-500"><i className="fa-solid fa-timeline mr-2 text-violet-500" />CRONOLOGÍA RECIENTE</p><div className="mt-4 space-y-3">{activityEvents.map((event, index) => { const meta = EVENT_META[event.type] || { icon: 'fa-circle-info', label: event.type, tone: 'text-slate-500' }; return <article key={event.id || `${event.type}-${index}`} className="flex gap-3"><span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-50 text-xs ${meta.tone}`}><i className={`fa-solid ${meta.icon}`} /></span><div className="min-w-0 flex-1 border-b border-slate-100 pb-3"><div className="flex items-center justify-between gap-3"><b className="text-xs text-slate-700">{meta.label}</b><span className="text-[10px] text-slate-400">{eventTime(event)}</span></div><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-500">{eventSummary(event)}</p></div></article>; })}</div></section>}
              {running && <div className="flex items-center gap-2 px-2 text-xs text-violet-600"><span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />{runtime?.active_tool ? `Zoco ejecuta ${runtime.active_tool} en tiempo real.` : 'Zoco está trabajando sobre la siguiente fase.'}</div>}
              <div ref={chatEndRef} />
            </div>}
          </section>
          <footer className="border-t border-[#e4e6ec] bg-white p-4"><div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-[#dfe2eb] bg-[#fbfcff] p-2 shadow-sm"><div className="hidden rounded-xl bg-[#f0f1f6] px-2 py-2 text-[10px] font-bold text-slate-500 sm:block">{activeTask ? 'CONTEXTO ACTIVO' : currentModel.label.toUpperCase()}</div><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (activeTask) void sendMessage(); else void createTask(); } }} placeholder={activeTask ? 'Añade una instrucción, un criterio o una nueva prioridad…' : 'Describe lo que quieres delegar al agente…'} rows={1} className="min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400" /><button onClick={() => { if (activeTask) void sendMessage(); else void createTask(); }} disabled={creating || !input.trim()} className="grid h-10 w-10 place-items-center rounded-xl bg-[#171923] text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-35"><i className={`fa-solid ${creating ? 'fa-spinner fa-spin' : 'fa-arrow-up'} text-sm`} /></button></div></footer>
        </main>

        <section className="flex w-[43%] max-w-[700px] shrink-0 flex-col border-l border-white/[.08] bg-[#111319] text-slate-200">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[.08] px-4"><div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#ff6f61]" /><span className="h-2.5 w-2.5 rounded-full bg-[#f4c95d]" /><span className="h-2.5 w-2.5 rounded-full bg-[#60d394]" /></div><div><p className="text-xs font-bold text-slate-200">Runtime de Zoco</p><p className="mt-0.5 text-[10px] text-slate-500">Actividad verificable del agente</p></div><div className="ml-auto flex rounded-lg border border-white/[.08] bg-white/[.03] p-0.5">{([['all', 'Todo'], ['terminal', 'Terminal'], ['files', 'Archivos'], ['web', 'Web']] as const).map(([tab, label]) => <button key={tab} onClick={() => setRuntimeTab(tab)} className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${runtimeTab === tab ? 'bg-white/[.12] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>)}</div></header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 font-mono text-xs">{visibleEvents.length === 0 ? <div className="flex h-full flex-col items-center justify-center text-center text-slate-600"><span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/[.08] bg-white/[.02] text-xl"><i className="fa-solid fa-display" /></span><p className="mt-4 text-xs text-slate-500">El ordenador mostrará las acciones verificables del agente.</p><p className="mt-1 max-w-[260px] text-[10px] leading-5 text-slate-600">Terminal, archivos, navegación, resultados y recuperación de estrategia se registrarán aquí.</p></div> : <div className="space-y-2.5">{visibleEvents.map((event, index) => { const meta = EVENT_META[event.type] || { icon: 'fa-circle-info', label: event.type, tone: 'text-slate-400' }; return <article key={event.id || `${event.type}-${index}`} className="overflow-hidden rounded-xl border border-white/[.08] bg-white/[.025]"><header className="flex items-center gap-2 border-b border-white/[.06] bg-white/[.025] px-3 py-2"><i className={`fa-solid ${meta.icon} text-[10px] ${meta.tone}`} /><span className="text-[10px] font-semibold text-slate-300">{meta.label}</span><span className="ml-auto text-[9px] text-slate-600">{eventTime(event)}</span></header><div className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-3 leading-5 text-slate-400">{event.type === 'browser_screenshot' && (event.captura || event.imagen) ? <><p className="mb-2 text-slate-300">{event.descripcion || 'Captura del agente'}</p><img src={String(event.captura || event.imagen).startsWith('data:') ? (event.captura || event.imagen) : `data:image/png;base64,${event.captura || event.imagen}`} alt="Captura del navegador del agente" className="w-full rounded-lg border border-white/[.08]" /></> : eventSummary(event)}</div></article>; })}<div ref={runtimeEndRef} /></div>}</div>
          <footer className="border-t border-white/[.08] px-4 py-3"><div className="flex items-center justify-between text-[10px] text-slate-500"><span className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />{running ? 'Sesión de agente activa' : 'Esperando una tarea'}</span><span>{events.length} eventos en contexto</span></div></footer>
        </section>
      </div>
    </div>
  );
}
