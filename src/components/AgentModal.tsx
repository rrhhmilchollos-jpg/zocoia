import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Textarea, Slider, Toggle, Badge, toast } from './ui';
import { useApi } from '../hooks/useApi';

const ALL_TOOLS = [
  { id: 'createFile', label: 'Crear archivo', icon: '📄', desc: 'Crea y sobreescribe archivos en el workspace' },
  { id: 'createFolder', label: 'Crear carpeta', icon: '📁', desc: 'Crea directorios en el workspace' },
  { id: 'readFile', label: 'Leer archivo', icon: '👁', desc: 'Lee contenido de archivos del workspace' },
  { id: 'listFiles', label: 'Listar archivos', icon: '📋', desc: 'Lista el contenido de una carpeta' },
  { id: 'deleteFile', label: 'Eliminar archivo', icon: '🗑', desc: 'Borra archivos del workspace' },
  { id: 'executeCode', label: 'Ejecutar código', icon: '⚡', desc: 'Sandbox E2B — Node.js / Python' },
  { id: 'busqueda_web', label: 'Búsqueda web', icon: '🌐', desc: 'Busca información actualizada en internet' },
  { id: 'abrirTerminalLinux', label: 'Terminal Linux', icon: '💻', desc: 'Terminal real en la nube (E2B)' },
  { id: 'controlarOrdenador', label: 'Ordenador virtual', icon: '🖥', desc: 'Escritorio virtual con navegador' },
  { id: 'gestionarPlan', label: 'Gestionar plan', icon: '📌', desc: 'Organiza tareas en pasos secuenciales' },
];

const MODELOS = [
  { value: 'zoco-flash', label: 'Zoco-Flash — Rápido' },
  { value: 'zoco-plus', label: 'Zoco-Plus — Equilibrado' },
  { value: 'zoco-max', label: 'Zoco-Max — Potente' },
  { value: 'zoco-lab', label: 'Zoco-Lab — Experimental' },
];

interface AgentData {
  tipo?: string;
  systemPrompt?: string;
  modelo?: string;
  temperature?: number;
  num_predict?: number;
  num_ctx?: number;
  busquedaWeb?: boolean;
  allowedTools?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  agente?: { id: string; name: string; data: AgentData } | null;
  onSaved: () => void;
}

export default function AgentModal({ open, onClose, agente, onSaved }: Props) {
  const { post, put } = useApi();
  const isEdit = !!agente;

  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [modelo, setModelo] = useState('zoco-plus');
  const [temperature, setTemperature] = useState(0.7);
  const [numPredict, setNumPredict] = useState(4096);
  const [numCtx, setNumCtx] = useState(8192);
  const [busquedaWeb, setBusquedaWeb] = useState(false);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'prompt' | 'params' | 'tools'>('prompt');

  useEffect(() => {
    if (agente) {
      setName(agente.name);
      const d = agente.data || {};
      setSystemPrompt(d.systemPrompt || '');
      setModelo(d.modelo || 'zoco-plus');
      setTemperature(d.temperature ?? 0.7);
      setNumPredict(d.num_predict ?? 4096);
      setNumCtx(d.num_ctx ?? 8192);
      setBusquedaWeb(d.busquedaWeb ?? false);
      setAllowedTools(d.allowedTools || []);
    } else {
      setName(''); setSystemPrompt(''); setModelo('zoco-plus');
      setTemperature(0.7); setNumPredict(4096); setNumCtx(8192);
      setBusquedaWeb(false); setAllowedTools([]);
    }
    setActiveTab('prompt');
  }, [agente, open]);

  const toggleTool = (id: string) =>
    setAllowedTools(p => p.includes(id) ? p.filter(t => t !== id) : [...p, id]);

  const handleSave = async () => {
    if (!name.trim()) { toast('error', 'El nombre es obligatorio'); return; }
    setSaving(true);
    const data: AgentData = {
      tipo: 'prompted',
      systemPrompt: systemPrompt.trim(),
      modelo,
      temperature,
      num_predict: numPredict,
      num_ctx: numCtx,
      busquedaWeb,
      allowedTools,
    };
    try {
      if (isEdit) {
        await put(`/api/resources/${agente!.id}`, { name: name.trim(), data });
        toast('success', 'Agente actualizado');
      } else {
        await post('/api/resources', { type: 'agente', name: name.trim(), data });
        toast('success', 'Agente creado');
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast('error', e.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'prompt', label: 'System Prompt' },
    { id: 'params', label: 'Hiperparámetros' },
    { id: 'tools', label: `Herramientas (${allowedTools.length})` },
  ] as const;

  return (
    <Modal open={open} onClose={onClose}
      title={isEdit ? `Configurar: ${agente!.name}` : 'Nuevo agente'}
      subtitle={isEdit ? 'Los cambios se aplican en caliente sin reiniciar el servidor' : 'Crea un agente con memoria persistente y herramientas propias'}
      size="lg">
      {/* Nombre */}
      <div className="mb-5">
        <label className="block text-xs text-gray-500 mb-1.5">Nombre del agente</label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Agente de Investigación" />
      </div>

      {/* Modelo */}
      <div className="mb-5">
        <label className="block text-xs text-gray-500 mb-1.5">Modelo base</label>
        <select value={modelo} onChange={e => setModelo(e.target.value)}
          className="w-full bg-[#111] border border-[#333] rounded-lg text-gray-200 text-sm px-3 py-2.5 focus:outline-none focus:border-purple-500">
          {MODELOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-[#111] p-1 rounded-lg mb-5 border border-[#222]">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === t.id ? 'bg-[#2a2a2a] text-white' : 'text-gray-500 hover:text-gray-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* System Prompt */}
      {activeTab === 'prompt' && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-gray-500">System prompt</label>
            <span className="text-[10px] text-gray-600">{systemPrompt.length} chars</span>
          </div>
          <Textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
            rows={10} placeholder="Eres un asistente especializado en... Describe aquí el rol, las capacidades y las restricciones del agente." />
          <p className="text-[10px] text-gray-600 mt-2">La regla de formato DeepSeek-R1 se añade automáticamente al guardar.</p>
        </div>
      )}

      {/* Hiperparámetros */}
      {activeTab === 'params' && (
        <div className="space-y-6">
          <Slider label="Temperatura" value={temperature} min={0} max={1.2} step={0.01} onChange={setTemperature} />
          <div>
            <div className="flex justify-between mb-1.5">
              <span className="text-xs text-gray-400">Tokens máximos (num_predict)</span>
              <span className="text-xs font-mono text-purple-400">{numPredict}</span>
            </div>
            <input type="range" min={256} max={8192} step={256} value={numPredict}
              onChange={e => setNumPredict(Number(e.target.value))}
              className="w-full h-1.5 bg-[#333] rounded-full appearance-none cursor-pointer accent-purple-500" />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1"><span>256</span><span>8192</span></div>
          </div>
          <div>
            <div className="flex justify-between mb-1.5">
              <span className="text-xs text-gray-400">Ventana de contexto (num_ctx)</span>
              <span className="text-xs font-mono text-purple-400">{numCtx.toLocaleString()}</span>
            </div>
            <input type="range" min={2048} max={16384} step={1024} value={numCtx}
              onChange={e => setNumCtx(Number(e.target.value))}
              className="w-full h-1.5 bg-[#333] rounded-full appearance-none cursor-pointer accent-purple-500" />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1"><span>2k</span><span>16k</span></div>
          </div>
          <Toggle checked={busquedaWeb} onChange={setBusquedaWeb} label="Activar búsqueda web automática" />
        </div>
      )}

      {/* Herramientas */}
      {activeTab === 'tools' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-500">Activa las herramientas que este agente puede usar</p>
            <div className="flex gap-2">
              <button onClick={() => setAllowedTools(ALL_TOOLS.map(t => t.id))} className="text-[10px] text-purple-400 hover:underline">Todas</button>
              <button onClick={() => setAllowedTools([])} className="text-[10px] text-gray-500 hover:underline">Ninguna</button>
            </div>
          </div>
          {ALL_TOOLS.map(tool => {
            const active = allowedTools.includes(tool.id);
            return (
              <div key={tool.id} onClick={() => toggleTool(tool.id)}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${active ? 'border-purple-700/50 bg-purple-950/20' : 'border-[#222] hover:border-[#333] bg-[#111]'}`}>
                <span className="text-lg w-6 text-center shrink-0">{tool.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white">{tool.label}</p>
                  <p className="text-[10px] text-gray-500 truncate">{tool.desc}</p>
                </div>
                <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${active ? 'bg-purple-500 border-purple-500' : 'border-[#444]'}`}>
                  {active && <span className="text-[9px] text-white font-bold">✓</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-end gap-3 mt-6 pt-5 border-t border-[#222]">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={handleSave} loading={saving}>{isEdit ? 'Guardar cambios' : 'Crear agente'}</Button>
      </div>
    </Modal>
  );
}
