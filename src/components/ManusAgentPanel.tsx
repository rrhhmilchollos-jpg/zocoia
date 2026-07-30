import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';
import { computeLineDiff } from '../lib/simpleDiff';

interface AgentStepEvent {
  task_id: string;
  step: number;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'file_diff' | 'error' | 'done';
  tool?: string;
  title: string;
  detail?: string;
  status: 'running' | 'success' | 'error';
  timestamp: string;
  data?: Record<string, any>;
}

interface FileChange {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  original_content?: string;
  new_content?: string;
  language?: string;
}

interface AgentRunResult {
  task_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  summary: string;
  instructions: string;
  repo?: {
    owner: string;
    name: string;
    base_branch: string;
    work_branch: string;
    commit_sha?: string;
    pull_request_url?: string;
  };
  files_changed: FileChange[];
  deployment?: {
    triggered: boolean;
    public_url?: string;
    deployment_uuid?: string;
  };
  error?: string;
}

type DiffTab = 'diferencia' | 'original' | 'modificado';

const STATUS_DOT: Record<AgentStepEvent['status'], string> = {
  running: 'bg-yellow-400 animate-pulse',
  success: 'bg-emerald-400',
  error: 'bg-rose-500',
};

export default function ManusAgentPanel() {
  const { token } = useAuth();

  const [repoUrl, setRepoUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [instructions, setInstructions] = useState('');
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [createPR, setCreatePR] = useState(true);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<AgentStepEvent[]>([]);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(null);
  const [diffTab, setDiffTab] = useState<DiffTab>('diferencia');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<{ id: string; text: string; type: 'cmd' | 'out' }[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLines]);

  const runAgent = useCallback(async () => {
    if (!repoUrl.trim() || !instructions.trim()) {
      setErrorMsg('Indica al menos la URL del repositorio y la instrucción.');
      return;
    }
    setErrorMsg(null);
    setSteps([]);
    setResult(null);
    setSelectedFile(null);
    setTerminalLines([]);
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/api/agent/run/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          instructions,
          repo_url: repoUrl,
          base_branch: baseBranch || undefined,
          auto_deploy: autoDeploy,
          create_pull_request: createPR,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error del servidor (HTTP ${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const lines = chunk.split('\n');
          const eventLine = lines.find((l) => l.startsWith('event:'));
          const dataLine = lines.find((l) => l.startsWith('data:'));
          if (!eventLine || !dataLine) continue;

          const eventName = eventLine.replace('event:', '').trim();
          const payload = JSON.parse(dataLine.replace('data:', '').trim());

          if (eventName === 'step') {
            const step = payload as AgentStepEvent;
            setSteps((prev) => [...prev, step]);

            // Capturar comandos de bash para la consola estilo Manus
            if (step.tool === 'execute_bash' || step.tool === 'bash') {
              if (step.type === 'tool_call') {
                const cmd = step.data?.command || step.detail || step.title || '';
                if (cmd) {
                  setTerminalLines(prev => [...prev, { 
                    id: `cmd-${step.task_id}-${step.step}-${Date.now()}`, 
                    text: `$ ${cmd}`, 
                    type: 'cmd' 
                  }]);
                }
              } else if (step.type === 'tool_result') {
                const out = step.data?.output || step.detail || '';
                if (out) {
                  setTerminalLines(prev => [...prev, { 
                    id: `out-${step.task_id}-${step.step}-${Date.now()}`, 
                    text: out, 
                    type: 'out' 
                  }]);
                }
              }
            }
          } else if (eventName === 'result') {
            const finalResult = payload as AgentRunResult;
            setResult(finalResult);
            if (finalResult.files_changed?.length) {
              setSelectedFile(finalResult.files_changed[0]);
            }
          } else if (eventName === 'error') {
            setErrorMsg(payload.error || 'Error desconocido del agente.');
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setErrorMsg(err.message || 'No se pudo conectar con el agente.');
      }
    } finally {
      setRunning(false);
    }
  }, [repoUrl, baseBranch, instructions, autoDeploy, createPR, token]);

  const cancelRun = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  return (
    <div className="flex flex-col gap-6 text-slate-100">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Columna izquierda: formulario + feed de pasos */}
        <div className="flex flex-col gap-4">
          <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-5">
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <span className="text-xl">🤖</span> Agente autónomo
            </h2>
            <p className="text-sm text-slate-400 mb-4">
              Dale una instrucción y la URL de un repo de GitHub. El agente explora el
              código, hace los cambios, abre un Pull Request y (opcionalmente) despliega.
            </p>

            <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
              Repositorio de GitHub
            </label>
            <input
              className="w-full mb-3 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="https://github.com/org/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={running}
            />

            <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
              Rama base (opcional)
            </label>
            <input
              className="w-full mb-3 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="zoco-ia-1"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              disabled={running}
            />

            <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1">
              Instrucción
            </label>
            <textarea
              className="w-full mb-3 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Ej: Añade un endpoint GET /health que devuelva { status: 'ok' }"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={running}
            />

            <div className="flex items-center gap-4 mb-4 text-sm text-slate-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createPR}
                  onChange={(e) => setCreatePR(e.target.checked)}
                  disabled={running}
                />
                Abrir Pull Request (recomendado)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDeploy}
                  onChange={(e) => setAutoDeploy(e.target.checked)}
                  disabled={running}
                />
                Desplegar en Coolify al terminar
              </label>
            </div>

            {errorMsg && (
              <div className="mb-3 text-sm text-rose-300 bg-rose-950/50 border border-rose-800 rounded-lg px-3 py-2">
                {errorMsg}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={runAgent}
                disabled={running}
                className="flex-1 bg-gradient-to-r from-indigo-500 to-blue-600 hover:opacity-90 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2 text-sm transition"
              >
                {running ? 'Ejecutando…' : '▶ Ejecutar agente'}
              </button>
              {running && (
                <button
                  onClick={cancelRun}
                  className="bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 rounded-lg px-4 py-2 text-sm transition"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>

          {/* Feed de pasos en vivo */}
          <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 flex-1 min-h-[260px] max-h-[480px] overflow-y-auto">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Actividad del agente</h3>
            {steps.length === 0 && !running && (
              <p className="text-sm text-slate-500">Aún no hay actividad. Lanza una tarea para verla aquí.</p>
            )}
            <ul className="space-y-2">
              {steps.map((s) => (
                <li key={`${s.task_id}-${s.step}`} className="flex items-start gap-2 text-sm">
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[s.status]}`} />
                  <div>
                    <span className="text-slate-200">{s.title}</span>
                    {s.tool && (
                      <span className="ml-2 text-xs text-slate-500 font-mono">[{s.tool}]</span>
                    )}
                    {s.detail && s.type === 'thinking' && (
                      <p className="text-xs text-slate-400 mt-0.5 whitespace-pre-wrap">{s.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {result && (
            <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-sm">
              <h3 className="text-sm font-semibold text-slate-300 mb-2">Resumen</h3>
              <p className="text-slate-300 mb-3">{result.summary}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span
                  className={`px-2 py-1 rounded-full ${
                    result.status === 'completed'
                      ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700'
                      : 'bg-rose-900/50 text-rose-300 border border-rose-700'
                  }`}
                >
                  {result.status === 'completed' ? 'Completada' : 'Falló'}
                </span>
                {result.repo?.pull_request_url && (
                  <a
                    href={result.repo.pull_request_url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-1 rounded-full bg-indigo-900/50 text-indigo-300 border border-indigo-700 hover:bg-indigo-800/50"
                  >
                    Ver Pull Request ↗
                  </a>
                )}
                {result.deployment?.triggered && result.deployment.public_url && (
                  <a
                    href={`https://${result.deployment.public_url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-1 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700 hover:bg-blue-800/50"
                  >
                    Ver app desplegada ↗
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Columna derecha: editor tipo Manus, Diferencia / Original / Modificado */}
        <div className="bg-slate-900/60 border border-slate-700 rounded-xl flex flex-col overflow-hidden min-h-[600px]">
          <div className="border-b border-slate-700 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-300">Editor</span>
            {result?.files_changed && result.files_changed.length > 1 && (
              <select
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs"
                value={selectedFile?.path || ''}
                onChange={(e) =>
                  setSelectedFile(result.files_changed.find((f) => f.path === e.target.value) || null)
                }
              >
                {result.files_changed.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.path}
                  </option>
                ))}
              </select>
            )}
          </div>

          {!selectedFile ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500 p-8 text-center">
              Cuando el agente modifique archivos, aparecerán aquí con su diff.
            </div>
          ) : (
            <>
              <div className="border-b border-slate-700 px-4 py-2 flex items-center gap-1 text-xs">
                <span className="text-slate-400 mr-2 font-mono truncate max-w-[240px]">
                  {selectedFile.path}
                </span>
                {(['diferencia', 'original', 'modificado'] as DiffTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDiffTab(tab)}
                    className={`px-3 py-1 rounded-md capitalize transition ${
                      diffTab === tab
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-auto font-mono text-xs">
                {diffTab === 'diferencia' && (
                  <DiffView original={selectedFile.original_content} modified={selectedFile.new_content} />
                )}
                {diffTab === 'original' && (
                  <PlainCode content={selectedFile.original_content || '(archivo nuevo, no existía)'} />
                )}
                {diffTab === 'modificado' && (
                  <PlainCode content={selectedFile.new_content || '(archivo eliminado)'} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Panel inferior: Consola estilo Terminal (Clon de Manus) */}
      <div className="bg-black border border-slate-800 rounded-xl overflow-hidden flex flex-col h-72 shadow-2xl">
        <div className="bg-[#1a1a1a] px-4 py-2 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 bg-[#ff5f56] rounded-full" />
              <div className="w-3 h-3 bg-[#ffbd2e] rounded-full" />
              <div className="w-3 h-3 bg-[#27c93f] rounded-full" />
            </div>
            <span className="ml-3 text-[11px] font-mono text-slate-400 uppercase tracking-wider">Terminal — Zoco Sandbox (E2B)</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500">bash — 80x24</div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-sm">
          {terminalLines.length === 0 ? (
            <div className="text-slate-700 italic">Esperando ejecución de comandos...</div>
          ) : (
            <div className="space-y-1">
              {terminalLines.map((line) => (
                <div 
                  key={line.id} 
                  className={`whitespace-pre-wrap break-all ${
                    line.type === 'cmd' ? 'text-white font-bold' : 'text-green-400'
                  }`}
                >
                  {line.text}
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DiffView({ original, modified }: { original?: string; modified?: string }) {
  const lines = computeLineDiff(original || '', modified || '');
  return (
    <table className="w-full border-collapse">
      <tbody>
        {lines.map((line, idx) => (
          <tr
            key={idx}
            className={
              line.type === 'added'
                ? 'bg-emerald-950/50'
                : line.type === 'removed'
                ? 'bg-rose-950/50'
                : ''
            }
          >
            <td className="select-none text-right pr-2 text-slate-600 w-10">
              {line.oldLineNumber ?? ''}
            </td>
            <td className="select-none text-right pr-2 text-slate-600 w-10">
              {line.newLineNumber ?? ''}
            </td>
            <td
              className={`pl-2 pr-4 whitespace-pre ${
                line.type === 'added'
                  ? 'text-emerald-300'
                  : line.type === 'removed'
                  ? 'text-rose-300'
                  : 'text-slate-300'
              }`}
            >
              {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
              {line.text}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlainCode({ content }: { content: string }) {
  return (
    <pre className="p-4 whitespace-pre-wrap text-slate-300 leading-relaxed">{content}</pre>
  );
}
