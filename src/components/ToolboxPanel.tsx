/**
 * ToolboxPanel.tsx
 * 
 * Panel interactivo para la gestión de habilidades (tools) en formato JSON Schema.
 * Estilo Claude Console profesional.
 */

import React, { useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';
import { Zap, Plus, Trash2, Edit3, Save, X, Loader2, Code, Info, AlertCircle } from 'lucide-react';

interface Tool {
  id: string;
  name: string;
  data: {
    descripcion: string;
    schema?: any;
    codigo?: string;
  };
}

export default function ToolboxPanel() {
  const { token } = useAuth();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schema, setSchema] = useState('{\n  "type": "object",\n  "properties": {\n    "param1": { "type": "string" }\n  }\n}');
  const [saveLoading, setSaveLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTools();
  }, []);

  const fetchTools = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/resources?type=habilidad`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setTools(data.resources || []);
      }
    } catch (err) {
      console.error('Error al cargar herramientas:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (tool?: Tool) => {
    if (tool) {
      setEditingTool(tool);
      setName(tool.name);
      setDescription(tool.data.descripcion || '');
      setSchema(JSON.stringify(tool.data.schema || {}, null, 2));
    } else {
      setEditingTool(null);
      setName('');
      setDescription('');
      setSchema('{\n  "type": "object",\n  "properties": {\n    "query": { "type": "string", "description": "Término de búsqueda" }\n  },\n  "required": ["query"]\n}');
    }
    setError('');
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('El nombre de la habilidad es obligatorio');
      return;
    }

    let parsedSchema = {};
    try {
      parsedSchema = JSON.parse(schema);
    } catch (e) {
      setError('El JSON Schema no es válido');
      return;
    }

    setSaveLoading(true);
    setError('');

    try {
      const method = editingTool ? 'PUT' : 'POST';
      const url = editingTool ? `/api/resources/${editingTool.id}` : '/api/resources';
      
      const toolData = {
        type: 'habilidad',
        name: name.trim(),
        data: {
          descripcion: description,
          schema: parsedSchema,
          updatedAt: new Date().toISOString()
        }
      };

      const response = await fetch(`${API_BASE}${url}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(toolData)
      });

      if (!response.ok) throw new Error('Error al guardar la habilidad');

      await fetchTools();
      setIsModalOpen(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar esta habilidad? Los agentes asociados dejarán de tener acceso a ella.')) return;

    try {
      const response = await fetch(`${API_BASE}/api/resources/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setTools(prev => prev.filter(t => t.id !== id));
      }
    } catch (err) {
      console.error('Error al eliminar:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center space-x-3">
            <Zap className="w-6 h-6 text-yellow-500" />
            <span>Toolbox de Habilidades</span>
          </h2>
          <p className="text-sm text-gray-500 mt-1">Define habilidades personalizadas en formato JSON Schema para tus agentes.</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-purple-500 hover:bg-purple-400 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center space-x-2 transition-all shadow-lg shadow-purple-500/20"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Habilidad</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tools.map(tool => (
            <div key={tool.id} className="bg-[#1a1a1a] border border-[#333] rounded-2xl p-5 hover:border-purple-500/50 transition-all group">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 bg-yellow-500/10 rounded-xl flex items-center justify-center border border-yellow-500/20">
                  <Zap className="w-5 h-5 text-yellow-500" />
                </div>
                <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleOpenModal(tool)}
                    className="p-2 text-gray-500 hover:text-white hover:bg-[#222] rounded-lg"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(tool.id)}
                    className="p-2 text-gray-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <h3 className="font-bold text-white mb-1 truncate">{tool.name}</h3>
              <p className="text-xs text-gray-500 line-clamp-2 h-8 mb-4">{tool.data.descripcion || 'Sin descripción'}</p>
              
              <div className="flex items-center justify-between pt-4 border-t border-[#333]">
                <div className="flex items-center space-x-2 text-[10px] text-gray-500 font-mono">
                  <Code className="w-3 h-3" />
                  <span>JSON Schema</span>
                </div>
                <span className="text-[10px] bg-[#222] px-2 py-0.5 rounded text-gray-400 uppercase tracking-tighter">Custom</span>
              </div>
            </div>
          ))}

          {tools.length === 0 && (
            <div className="col-span-full py-20 text-center border-2 border-dashed border-[#222] rounded-2xl">
              <Zap className="w-12 h-12 text-[#222] mx-auto mb-4" />
              <p className="text-gray-500">No hay habilidades personalizadas todavía.</p>
              <button 
                onClick={() => handleOpenModal()}
                className="mt-4 text-purple-500 hover:underline text-sm font-bold"
              >
                Crea tu primera habilidad ahora
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal de Edición/Creación */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#1a1a1a] border border-[#333] w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#333] bg-[#222]">
              <h2 className="text-lg font-bold text-white">
                {editingTool ? 'Editar Habilidad' : 'Nueva Habilidad'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-gray-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Nombre de la Herramienta</label>
                    <input 
                      type="text" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="ej: buscar_vuelos"
                      className="w-full bg-[#0d0d0d] border border-[#333] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Descripción para el LLM</label>
                    <textarea 
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                      placeholder="Esta herramienta sirve para..."
                      className="w-full bg-[#0d0d0d] border border-[#333] rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-purple-500/50 transition-all resize-none"
                    />
                  </div>
                  <div className="bg-blue-500/5 border border-blue-500/10 p-4 rounded-xl flex items-start space-x-3">
                    <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-blue-300/70 leading-relaxed">
                      La descripción es fundamental: indica al modelo **cuándo** y **cómo** debe invocar esta herramienta.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Parámetros (JSON Schema)</label>
                  <textarea 
                    value={schema}
                    onChange={(e) => setSchema(e.target.value)}
                    rows={12}
                    className="w-full bg-[#0d0d0d] border border-[#333] rounded-xl px-4 py-3 text-white font-mono text-xs leading-relaxed focus:outline-none focus:border-purple-500/50 transition-all resize-none"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[#333] bg-[#222] flex justify-end space-x-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-2.5 text-sm font-medium text-gray-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={saveLoading}
                className="bg-purple-500 hover:bg-purple-400 text-white px-8 py-2.5 rounded-xl font-bold text-sm flex items-center space-x-2 transition-all disabled:opacity-50"
              >
                {saveLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{editingTool ? 'Actualizar' : 'Crear Habilidad'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
