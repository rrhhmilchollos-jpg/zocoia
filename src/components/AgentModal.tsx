/**
 * AgentModal.tsx
 * 
 * Modal profesional para la creación y edición avanzada de agentes.
 * Estilo Claude Console con Tailwind CSS.
 */

import React, { useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';
import { X, Settings, Zap, Shield, Save, Loader2, Info } from 'lucide-react';

interface Tool {
  id: string;
  name: string;
  data: any;
}

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (agent: any) => void;
  agent?: any;
}

export default function AgentModal({ isOpen, onClose, onSuccess, agent }: AgentModalProps) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [modelo, setModelo] = useState('zoco-plus');
  const [temperatura, setTemperatura] = useState(0.7);
  const [contexto, setContexto] = useState(8192);
  const [penalizacion, setPenalizacion] = useState(0.0);
  
  const [availableTools, setAvailableTools] = useState<Tool[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'config' | 'tools'>('config');

  useEffect(() => {
    if (isOpen) {
      fetchTools();
      if (agent) {
        setName(agent.name || '');
        const data = typeof agent.data === 'string' ? JSON.parse(agent.data) : agent.data || {};
        setSystemPrompt(data.systemPrompt || '');
        setModelo(data.modelo || 'zoco-plus');
        setTemperatura(data.temperature || data.temperatura || 0.7);
        setContexto(data.num_ctx || data.contexto || 8192);
        setPenalizacion(data.frequency_penalty || 0.0);
        setSelectedTools(data.allowedTools || data.herramientasAsociadas || []);
      } else {
        setName('');
        setSystemPrompt('');
        setModelo('zoco-plus');
        setTemperatura(0.7);
        setContexto(8192);
        setPenalizacion(0.0);
        setSelectedTools([]);
      }
      setError('');
      setActiveTab('config');
    }
  }, [agent, isOpen]);

  const fetchTools = async () => {
    setToolsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/resources?type=habilidad`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAvailableTools(data.resources || []);
      }
    } catch (err) {
      console.error('Error al cargar herramientas:', err);
    } finally {
      setToolsLoading(false);
    }
  };

  const toggleTool = (toolName: string) => {
    setSelectedTools(prev => 
      prev.includes(toolName) 
        ? prev.filter(t => t !== toolName) 
        : [...prev, toolName]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('El nombre del agente es obligatorio');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const method = agent ? 'PUT' : 'POST';
      const url = agent ? `/api/resources/${agent.id}` : '/api/resources';
      
      const agentData = {
        type: 'agente',
        name: name.trim(),
        data: {
          systemPrompt,
          modelo,
          temperature: temperatura,
          num_ctx: contexto,
          frequency_penalty: penalizacion,
          allowedTools: selectedTools,
          updatedAt: new Date().toISOString()
        }
      };

      const response = await fetch(`${API_BASE}${url}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(agentData)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Error al guardar el agente');
      }

      const result = await response.json();
      onSuccess(result);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm transition-all duration-300">
      <div className="bg-[#1a1a1a] border border-[#333] w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#333] bg-[#222]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center border border-purple-500/20">
              <Settings className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-none">
                {agent ? 'Configuración del Agente' : 'Nuevo Agente Zoco'}
              </h2>
              <p className="text-xs text-gray-500 mt-1 uppercase tracking-tighter">Claude Console Style v2.0</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white transition-colors rounded-lg hover:bg-[#333]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#333] px-6 bg-[#1a1a1a]">
          <button 
            onClick={() => setActiveTab('config')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-all ${activeTab === 'config' ? 'border-purple-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            Configuración Base
          </button>
          <button 
            onClick={() => setActiveTab('tools')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-all ${activeTab === 'tools' ? 'border-purple-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            Habilidades (Toolbox)
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {activeTab === 'config' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left Column: Core Prompt */}
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Nombre Identificativo</label>
                  <input 
                    type="text" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="ej: Zoco Architect"
                    className="w-full bg-[#0d0d0d] border border-[#333] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50 focus:ring-4 focus:ring-purple-500/5 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">System Prompt (Identidad)</label>
                  <textarea 
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={12}
                    placeholder="Eres un experto en..."
                    className="w-full bg-[#0d0d0d] border border-[#333] rounded-xl px-4 py-3 text-white font-mono text-xs leading-relaxed focus:outline-none focus:border-purple-500/50 focus:ring-4 focus:ring-purple-500/5 transition-all resize-none"
                  />
                </div>
              </div>

              {/* Right Column: Hyperparameters */}
              <div className="space-y-6 bg-[#222]/30 p-6 rounded-2xl border border-[#333]/50">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  <span>Hiperparámetros de Inferencia</span>
                </h3>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Motor de Inferencia</label>
                  <select 
                    value={modelo}
                    onChange={(e) => setModelo(e.target.value)}
                    className="w-full bg-[#0d0d0d] border border-[#333] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50 transition-all"
                  >
                    <option value="zoco-plus">Zoco Plus (Llama-3.3-70B)</option>
                    <option value="zoco-max">Zoco Max (Mixtral-8x7B)</option>
                    <option value="zoco-flash">Zoco Flash (Llama-3.1-8B)</option>
                  </select>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Temperatura</label>
                      <span className="text-xs font-mono text-purple-400">{temperatura}</span>
                    </div>
                    <input 
                      type="range" min="0" max="2" step="0.1"
                      value={temperatura}
                      onChange={(e) => setTemperatura(parseFloat(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Contexto (Tokens)</label>
                      <span className="text-xs font-mono text-purple-400">{contexto}</span>
                    </div>
                    <input 
                      type="range" min="1024" max="32768" step="1024"
                      value={contexto}
                      onChange={(e) => setContexto(parseInt(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Penalización Frecuencia</label>
                      <span className="text-xs font-mono text-purple-400">{penalizacion}</span>
                    </div>
                    <input 
                      type="range" min="0" max="2" step="0.1"
                      value={penalizacion}
                      onChange={(e) => setPenalizacion(parseFloat(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-[#333] flex items-start space-x-3 text-[#666]">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-[10px] leading-tight">
                    Estos ajustes se inyectan directamente en el motor de inferencia local de Ollama o en la API de Groq Cloud para afinar la respuesta del agente.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <Shield className="w-4 h-4 text-emerald-500" />
                    <span>Habilidades del Sistema (Toolbox)</span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">Selecciona las herramientas que este agente tendrá permitidas usar.</p>
                </div>
                <div className="text-[10px] text-gray-500 font-mono">
                  {selectedTools.length} seleccionadas
                </div>
              </div>

              {toolsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Herramientas Nativas (hardcoded) */}
                  {['busqueda_web', 'readFile', 'createFile', 'executeCode'].map(tool => (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => toggleTool(tool)}
                      className={`flex items-center p-4 rounded-xl border transition-all text-left ${
                        selectedTools.includes(tool) 
                          ? 'bg-purple-500/10 border-purple-500/50 text-white' 
                          : 'bg-[#0d0d0d] border-[#333] text-gray-500 hover:border-[#444]'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mr-3 ${
                        selectedTools.includes(tool) ? 'bg-purple-500 text-white' : 'bg-[#222] text-gray-600'
                      }`}>
                        <Zap className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-tighter">{tool}</div>
                        <div className="text-[10px] opacity-60">Nativa del Sistema</div>
                      </div>
                    </button>
                  ))}

                  {/* Herramientas de la Base de Datos */}
                  {availableTools.map(tool => (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => toggleTool(tool.name)}
                      className={`flex items-center p-4 rounded-xl border transition-all text-left ${
                        selectedTools.includes(tool.name) 
                          ? 'bg-purple-500/10 border-purple-500/50 text-white' 
                          : 'bg-[#0d0d0d] border-[#333] text-gray-500 hover:border-[#444]'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mr-3 ${
                        selectedTools.includes(tool.name) ? 'bg-purple-500 text-white' : 'bg-[#222] text-gray-600'
                      }`}>
                        <Settings className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-tighter truncate max-w-[120px]">{tool.name}</div>
                        <div className="text-[10px] opacity-60">Custom Skill</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#333] bg-[#222] flex items-center justify-between">
          <div className="text-[10px] text-gray-500 font-mono italic">
            Zoco Engine v2.0 • Build 0730
          </div>
          <div className="flex space-x-3">
            <button 
              type="button" 
              onClick={onClose}
              className="px-6 py-2.5 text-sm font-medium text-gray-400 hover:text-white transition-colors"
            >
              Descartar
            </button>
            <button 
              onClick={handleSubmit}
              disabled={loading}
              className="bg-purple-500 hover:bg-purple-400 text-white px-8 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-purple-500/20 flex items-center space-x-2 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{agent ? 'Guardar Cambios' : 'Crear Agente'}</span>
            </button>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #444; }
      `}} />
    </div>
  );
}
