import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

/* ── Tipos (espejo de manus-agent/types.ts) ── */
interface AgentStep {
  task_id: string;
  step: number;
  timestamp: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error';
  tool?: string;
  title: string;
  detail?: string;
  status: 'running' | 'success' | 'error';
  data?: any;
}

interface FileChange {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  original_content?: string;
  new_content?: string;
  language?: string;
}

interface AgentResult {
  task_id: string;
  status: 'completed' | 'failed';
  summary: string;
  instructions: string;
  repo?: { owner: string; name: string; base_branch: string; work_branch: string; commit_sha?: string; pull_request_url?: string; };
  files_changed: FileChange[];
  deployment?: { triggered: boolean; public_url?: string; deployment_uuid?: string; };
  steps: AgentStep[];
  started_at: string;
  finished_at: string;
  error?: string;
}

interface Task {
  id: string;
  instructions: string;
  repo_url: string;
  status: 'running' | 'completed' | 'failed';
  result?: AgentResult;
  steps: AgentStep[];
  startedAt: string;
}

/* ── Iconos por tipo de paso ── */
const STEP_ICONS: Record<string, string> = {
  thinking: '💭', tool_call: '⚡', tool_result: '✓', done: '🎉', error: '✕',
  github_clone: '📦', read_file: '👁', write_file: '✏️', list_files: '📁',
  delete_file: '🗑', finish_task: '✓', github_commit_push: '🔀',
  github_create_pr: '🔃', coolify_deploy: '🚀',
};

const STEP_COLORS: Record<string, string> = {
  running: 'text-blue-400 border-blue-700/40 bg-blue-950/20',
  success: 'text-green-400 border-green-700/40 bg-green-950/20',
  error: 'text-red-400 border-red-700/40 bg-red-950/20',
};

const FILE_ACTION_COLORS: Record<string, string> = {
  created: 'text-green-400 bg-green-950/30 border-green-700/30',
  modified: 'text-blue-400 bg-blue-950/30 border-blue-700/30',
  deleted: 'text-red-400 bg-red-950/30 border-red-700/30',
};

export default function ManusAgent() {
  const { token } = useAuth();

  // Estado principal
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Formulario nueva tarea
  const [instructions, setInstructions] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [createPR, setCreatePR] = useState(true);
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [showForm, setShowForm] = useState(true);

  // Vista del panel derecho
  const [rightPanel, setRightPanel] = useState<'steps' | 'files' | 'result'>('steps');
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const stepsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeTask = tasks.find(t => t.id === activeTaskId) || null;

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeTask?.steps]);

  const authHeaders = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const handleRun = async () => {
    if (!instructions.trim() || !repoUrl.trim() || running) return;

    const taskId = `task_${Date.now()}`;
    const newTask: Task = {
      id: taskId,
      instructions: instructions.trim(),
      repo_url: repoUrl.trim(),
      status: 'running',
      steps: [],
      startedAt: new Date().toISOString(),
    };

    setTasks(p => [newTask, ...p]);
    setActiveTaskId(taskId);
    setRunning(true);
    setShowForm(false);
    setRightPanel('steps');

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${API_BASE}/api/agent/run/stream`, {
        method: 'POST',
        headers: authHeaders(),
        signal: ctrl.signal,
        body: JSON.stringify({
          instructions: instructions.trim(),
          repo_url: repoUrl.trim(),
          create_pull_request: createPR,
          auto_deploy: autoDeploy,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setTasks(p => p.map(t => t.id === taskId ? { ...t, status: 'failed', steps: [...t.steps, { task_id: taskId, step: 1, timestamp: new Date().toISOString(), type: 'error', title: err.error || 'Error al iniciar el agente', status: 'error' }] } : t));
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let event = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
          if (line.startsWith('data: ')) {
            const raw = line.slice(6);
            try {
              const data = JSON.parse(raw);
              if (event === 'step') {
                setTasks(p => p.map(t => t.id === taskId ? { ...t, steps: [...t.steps, data as AgentStep] } : t));
              } else if (event === 'result') {
                const result = data as AgentResult;
                setTasks(p => p.map(t => t.id === taskId ? { ...t, status: result.status, result } : t));
                if (result.files_changed?.length > 0) setRightPanel('files');
              } else if (event === 'error') {
                setTasks(p => p.map(t => t.id === taskId ? { ...t, status: 'failed' } : t));
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setTasks(p => p.map(t => t.id === taskId ? { ...t, status: 'failed' } : t));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const handleNewTask = () => {
    setInstructions('');
    setShowForm(true);
    setActiveTaskId(null);
  };

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex h-full gap-0" style={{ height: 'calc(100vh - 100px)' }}>

      {/* ── Sidebar izquierdo: historial de tareas ── */}
      <div className="w-64 shrink-0 flex flex-col border-r border-[#222] pr-4 mr-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white">Tareas</h2>
          <button onClick={handleNewTask}
            className="text-xs px-2.5 py-1.5 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition-colors">
            + Nueva
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {tasks.length === 0 && (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">🤖</div>
              <p className="text-gray-600 text-xs">Sin tareas todavía</p>
            </div>
          )}
          {tasks.map(task => (
            <div key={task.id} onClick={() => { setActiveTaskId(task.id); setShowForm(false); }}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${activeTaskId === task.id ? 'border-purple-600/50 bg-purple-950/20' : 'border-[#222] hover:border-[#333] bg-[#1a1a1a]'}`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-xs text-white font-medium line-clamp-2 flex-1">{task.instructions}</p>
                <span className={`shrink-0 w-2 h-2 rounded-full mt-1 ${task.status === 'running' ? 'bg-blue-400 animate-pulse' : task.status === 'completed' ? 'bg-green-400' : 'bg-red-400'}`} />
              </div>
              <p className="text-[10px] text-gray-600 truncate">{task.repo_url.replace('https://github.com/', '')}</p>
              <p className="text-[10px] text-gray-700 mt-1">{formatDate(task.startedAt)}</p>
              {task.result?.files_changed?.length > 0 && (
                <p className="text-[10px] text-purple-400 mt-1">{task.result.files_changed.length} archivo{task.result.files_changed.length !== 1 ? 's' : ''} modificado{task.result.files_changed.length !== 1 ? 's' : ''}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Panel central ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Formulario nueva tarea */}
        {showForm ? (
          <div className="flex-1 flex flex-col justify-center max-w-2xl mx-auto w-full">
            <div className="text-center mb-8">
              <div className="text-5xl mb-3">🤖</div>
              <h1 className="text-2xl font-bold text-white mb-2">Agente de Zoco</h1>
              <p className="text-gray-500 text-sm">Dale una tarea en lenguaje natural. El agente clonará el repo, hará los cambios y creará un PR automáticamente.</p>
            </div>

            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-6 space-y-5">
              <div>
                <label className="block text-xs text-gray-500 mb-2">Repositorio de GitHub</label>
                <input value={repoUrl} onChange={e => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/usuario/repo"
                  className="w-full bg-[#111] border border-[#333] rounded-xl text-gray-200 text-sm px-4 py-3 focus:outline-none focus:border-purple-500 placeholder-gray-600" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-2">Instrucción para el agente</label>
                <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
                  placeholder="Ej: Arregla el error de sintaxis en src/routes/apps.ts donde hay una variable definida con espacio en el nombre. Revisa también si hay otros errores de TypeScript similares."
                  rows={5}
                  className="w-full bg-[#111] border border-[#333] rounded-xl text-gray-200 text-sm px-4 py-3 focus:outline-none focus:border-purple-500 placeholder-gray-600 resize-none" />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <div className={`relative w-8 rounded-full transition-colors ${createPR ? 'bg-purple-500' : 'bg-[#333]'}`} style={{ height: '18px' }} onClick={() => setCreatePR(p => !p)}>
                    <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-all ${createPR ? 'left-4' : 'left-0.5'}`} />
                  </div>
                  <span className="text-xs text-gray-400">Crear Pull Request</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <div className={`relative w-8 rounded-full transition-colors ${autoDeploy ? 'bg-purple-500' : 'bg-[#333]'}`} style={{ height: '18px' }} onClick={() => setAutoDeploy(p => !p)}>
                    <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-all ${autoDeploy ? 'left-4' : 'left-0.5'}`} />
                  </div>
                  <span className="text-xs text-gray-400">Auto-deploy en Coolify</span>
                </label>
              </div>
              <button onClick={handleRun} disabled={!instructions.trim() || !repoUrl.trim() || running}
                className="w-full py-3 bg-white text-black font-bold rounded-xl hover:bg-gray-200 disabled:opacity-40 transition-colors text-sm">
                🚀 Ejecutar agente
              </button>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { icon: '🔍', title: 'Analiza el repo', desc: 'Explora la estructura y lee los archivos relevantes' },
                { icon: '✏️', title: 'Hace los cambios', desc: 'Escribe, modifica o elimina archivos con precisión quirúrgica' },
                { icon: '🔀', title: 'Crea el PR', desc: 'Commit, push y Pull Request automáticamente' },
              ].map(f => (
                <div key={f.title} className="bg-[#1a1a1a] border border-[#222] rounded-xl p-4 text-center">
                  <div className="text-2xl mb-2">{f.icon}</div>
                  <p className="text-xs font-medium text-white mb-1">{f.title}</p>
                  <p className="text-[10px] text-gray-500 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : activeTask ? (
          <div className="flex flex-col h-full">
            {/* Header tarea activa */}
            <div className="flex items-start justify-between mb-4 pb-4 border-b border-[#222]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${activeTask.status === 'running' ? 'bg-blue-400 animate-pulse' : activeTask.status === 'completed' ? 'bg-green-400' : 'bg-red-400'}`} />
                  <span className="text-[11px] text-gray-500">
                    {activeTask.status === 'running' ? 'Trabajando...' : activeTask.status === 'completed' ? 'Completada' : 'Fallida'}
                    {activeTask.steps.length > 0 && ` · Paso ${activeTask.steps.length}`}
                  </span>
                </div>
                <p className="text-white font-medium text-sm line-clamp-2">{activeTask.instructions}</p>
                <p className="text-[11px] text-gray-600 mt-1">{activeTask.repo_url.replace('https://github.com/', '')}</p>
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                {activeTask.status === 'running' && (
                  <button onClick={handleStop} className="text-xs px-3 py-1.5 bg-red-950/50 border border-red-700/40 text-red-400 rounded-lg hover:bg-red-950/70">
                    ⏹ Detener
                  </button>
                )}
                {activeTask.result?.repo?.pull_request_url && (
                  <a href={activeTask.result.repo.pull_request_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 bg-purple-950/50 border border-purple-700/40 text-purple-400 rounded-lg hover:bg-purple-950/70">
                    🔃 Ver PR
                  </a>
                )}
                {activeTask.result?.deployment?.public_url && (
                  <a href={`https://${activeTask.result.deployment.public_url}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 bg-green-950/50 border border-green-700/40 text-green-400 rounded-lg hover:bg-green-950/70">
                    🚀 Ver deploy
                  </a>
                )}
              </div>
            </div>

            {/* Resumen final si completado */}
            {activeTask.result?.summary && (
              <div className={`mb-4 p-4 rounded-xl border text-sm leading-relaxed ${activeTask.status === 'completed' ? 'bg-green-950/20 border-green-700/30 text-green-300' : 'bg-red-950/20 border-red-700/30 text-red-300'}`}>
                <p className="font-medium mb-1">{activeTask.status === 'completed' ? '✅' : '❌'} {activeTask.status === 'completed' ? 'Completado' : 'Error'}</p>
                <p className="text-xs opacity-80">{activeTask.result.summary || activeTask.result.error}</p>
              </div>
            )}

            {/* Feed de pasos en vivo */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {activeTask.steps.map((step, i) => (
                <div key={i} className={`flex gap-3 p-3 rounded-xl border transition-all ${STEP_COLORS[step.status]}`}>
                  <span className="text-base shrink-0 mt-0.5">
                    {STEP_ICONS[step.tool || step.type] || STEP_ICONS[step.type] || '⚡'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium truncate">{step.title}</p>
                      <span className="text-[10px] opacity-50 shrink-0">{formatTime(step.timestamp)}</span>
                    </div>
                    {step.detail && (
                      <p className="text-[11px] opacity-70 mt-1 leading-relaxed line-clamp-3">{step.detail}</p>
                    )}
                    {step.type === 'tool_result' && step.data?.output && typeof step.data.output === 'string' && step.data.output.length > 0 && step.data.output.length < 300 && (
                      <code className="block text-[10px] bg-black/30 rounded-lg px-2 py-1.5 mt-1.5 font-mono opacity-70 truncate">{step.data.output}</code>
                    )}
                    {step.status === 'running' && (
                      <div className="flex gap-1 mt-1.5">
                        <span className="w-1 h-1 bg-current rounded-full animate-bounce" />
                        <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                        <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {activeTask.status === 'running' && activeTask.steps.length === 0 && (
                <div className="flex items-center gap-3 p-4 bg-blue-950/20 border border-blue-700/30 rounded-xl">
                  <svg className="animate-spin w-4 h-4 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <p className="text-blue-400 text-xs">Iniciando agente...</p>
                </div>
              )}
              <div ref={stepsEndRef} />
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Panel derecho: archivos modificados ── */}
      {activeTask && !showForm && (
        <div className="w-80 shrink-0 flex flex-col border-l border-[#222] pl-4 ml-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-[#111] p-1 rounded-lg border border-[#222] mb-4">
            {(['steps', 'files', 'result'] as const).map(tab => {
              const labels = { steps: `Pasos (${activeTask.steps.length})`, files: `Archivos (${activeTask.result?.files_changed?.length || 0})`, result: 'Resultado' };
              return (
                <button key={tab} onClick={() => setRightPanel(tab)}
                  className={`flex-1 py-1.5 text-[10px] font-medium rounded-md transition-colors ${rightPanel === tab ? 'bg-[#2a2a2a] text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                  {labels[tab]}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* Resumen de pasos */}
            {rightPanel === 'steps' && (
              <div className="space-y-1.5">
                {activeTask.steps.length === 0 ? (
                  <p className="text-gray-600 text-xs text-center py-8">Los pasos aparecerán aquí en tiempo real</p>
                ) : activeTask.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg hover:bg-[#1a1a1a]">
                    <span className="text-sm shrink-0 mt-0.5">{STEP_ICONS[step.tool || step.type] || '⚡'}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-300 truncate">{step.title}</p>
                      <p className="text-[10px] text-gray-600">{formatTime(step.timestamp)}</p>
                    </div>
                    <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${step.status === 'success' ? 'bg-green-400' : step.status === 'error' ? 'bg-red-400' : 'bg-blue-400 animate-pulse'}`} />
                  </div>
                ))}
              </div>
            )}

            {/* Archivos modificados */}
            {rightPanel === 'files' && (
              <div>
                {!activeTask.result?.files_changed?.length ? (
                  <p className="text-gray-600 text-xs text-center py-8">
                    {activeTask.status === 'running' ? 'Los archivos modificados aparecerán al terminar' : 'Sin cambios de archivos'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {activeTask.result.files_changed.map(file => (
                      <div key={file.path}>
                        <div
                          onClick={() => setExpandedFile(expandedFile === file.path ? null : file.path)}
                          className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer hover:opacity-90 transition-all ${FILE_ACTION_COLORS[file.action]}`}>
                          <span className="text-xs shrink-0">{file.action === 'created' ? '✚' : file.action === 'deleted' ? '−' : '~'}</span>
                          <p className="text-[11px] font-mono truncate flex-1">{file.path}</p>
                          <span className="text-[9px] uppercase font-bold opacity-60">{file.action}</span>
                          <span className="text-[10px] opacity-50">{expandedFile === file.path ? '▲' : '▼'}</span>
                        </div>
                        {expandedFile === file.path && file.new_content && (
                          <div className="mt-1 bg-[#0a0a0a] border border-[#222] rounded-xl overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-[#222]">
                              <span className="text-[10px] text-gray-500 font-mono">{file.path}</span>
                              <button onClick={() => navigator.clipboard.writeText(file.new_content!)}
                                className="text-[10px] text-purple-400 hover:underline">Copiar</button>
                            </div>
                            <pre className="p-3 text-[10px] text-gray-300 font-mono overflow-x-auto max-h-60 overflow-y-auto leading-relaxed whitespace-pre-wrap break-all">
                              {file.new_content.slice(0, 3000)}{file.new_content.length > 3000 ? '\n... (truncado)' : ''}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Resultado completo */}
            {rightPanel === 'result' && (
              <div className="space-y-4">
                {!activeTask.result ? (
                  <p className="text-gray-600 text-xs text-center py-8">El resultado aparecerá al terminar</p>
                ) : (
                  <>
                    <div className={`p-4 rounded-xl border ${activeTask.status === 'completed' ? 'bg-green-950/20 border-green-700/30' : 'bg-red-950/20 border-red-700/30'}`}>
                      <p className="text-xs font-bold text-white mb-2">{activeTask.status === 'completed' ? '✅ Completado' : '❌ Fallido'}</p>
                      <p className="text-[11px] text-gray-400 leading-relaxed">{activeTask.result.summary || activeTask.result.error}</p>
                    </div>

                    {activeTask.result.repo && (
                      <div className="bg-[#1a1a1a] border border-[#222] rounded-xl p-4 space-y-2 text-xs">
                        <p className="font-bold text-white mb-2">📦 Repositorio</p>
                        {[
                          ['Rama base', activeTask.result.repo.base_branch],
                          ['Rama trabajo', activeTask.result.repo.work_branch],
                          ['Commit', activeTask.result.repo.commit_sha?.slice(0, 8)],
                        ].filter(([, v]) => v).map(([k, v]) => (
                          <div key={k} className="flex justify-between">
                            <span className="text-gray-500">{k}</span>
                            <code className="text-gray-300 font-mono text-[10px]">{v}</code>
                          </div>
                        ))}
                        {activeTask.result.repo.pull_request_url && (
                          <a href={activeTask.result.repo.pull_request_url} target="_blank" rel="noopener noreferrer"
                            className="block mt-2 text-center py-2 bg-purple-950/40 border border-purple-700/30 text-purple-400 rounded-lg hover:bg-purple-950/60 transition-colors">
                            🔃 Abrir Pull Request
                          </a>
                        )}
                      </div>
                    )}

                    {activeTask.result.deployment?.triggered && (
                      <div className="bg-[#1a1a1a] border border-[#222] rounded-xl p-4 text-xs">
                        <p className="font-bold text-white mb-2">🚀 Deploy</p>
                        {activeTask.result.deployment.public_url && (
                          <a href={`https://${activeTask.result.deployment.public_url}`} target="_blank" rel="noopener noreferrer"
                            className="block text-center py-2 bg-green-950/40 border border-green-700/30 text-green-400 rounded-lg hover:bg-green-950/60 transition-colors">
                            🌐 Ver aplicación en vivo
                          </a>
                        )}
                      </div>
                    )}

                    <div className="bg-[#1a1a1a] border border-[#222] rounded-xl p-4 text-xs">
                      <p className="font-bold text-white mb-2">⏱ Tiempo</p>
                      <div className="space-y-1">
                        <div className="flex justify-between"><span className="text-gray-500">Inicio</span><span className="text-gray-300">{formatDate(activeTask.result.started_at)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Fin</span><span className="text-gray-300">{formatDate(activeTask.result.finished_at)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Pasos</span><span className="text-gray-300">{activeTask.result.steps.length}</span></div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
