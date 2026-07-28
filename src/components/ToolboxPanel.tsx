import React, { useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

interface Tool {
  id: string;
  name: string;
  description: string;
  jsonSchema: string;
  createdAt: string;
}

interface ToolboxPanelProps {
  agentId?: string;
  onToolsUpdate?: (tools: Tool[]) => void;
}

export default function ToolboxPanel({ agentId, onToolsUpdate }: ToolboxPanelProps) {
  const { token } = useAuth();
  const [tools, setTools] = useState<Tool[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [newToolName, setNewToolName] = useState('');
  const [newToolDescription, setNewToolDescription] = useState('');
  const [newToolSchema, setNewToolSchema] = useState('{}');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [schemaError, setSchemaError] = useState('');

  useEffect(() => {
    loadTools();
  }, []);

  const loadTools = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/resources?type=habilidad`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setTools(
          data.map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.data?.description || '',
            jsonSchema: t.data?.jsonSchema || '{}',
            createdAt: t.created_at,
          }))
        );
      }
    } catch (err) {
      console.error('Error loading tools:', err);
    }
  };

  const validateJsonSchema = (schema: string): boolean => {
    try {
      JSON.parse(schema);
      setSchemaError('');
      return true;
    } catch (err: any) {
      setSchemaError(`JSON inválido: ${err.message}`);
      return false;
    }
  };

  const handleCreateTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newToolName.trim() || !validateJsonSchema(newToolSchema)) {
      setError('Por favor completa todos los campos correctamente');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/resources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: 'habilidad',
          name: newToolName.trim(),
          data: {
            description: newToolDescription.trim(),
            jsonSchema: JSON.parse(newToolSchema),
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al crear la herramienta');
      }

      const result = await response.json();
      setTools((prev) => [
        ...prev,
        {
          id: result.id,
          name: result.name,
          description: result.data?.description || '',
          jsonSchema: JSON.stringify(result.data?.jsonSchema || {}),
          createdAt: result.created_at,
        },
      ]);

      setNewToolName('');
      setNewToolDescription('');
      setNewToolSchema('{}');
      setShowCreateForm(false);
      onToolsUpdate?.([...tools]);
    } catch (err: any) {
      setError(err.message || 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTool = async (toolId: string) => {
    if (!confirm('¿Eliminar esta herramienta?')) return;

    try {
      const response = await fetch(`${API_BASE}/api/resources/${toolId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setTools((prev) => prev.filter((t) => t.id !== toolId));
        onToolsUpdate?.(tools.filter((t) => t.id !== toolId));
      }
    } catch (err) {
      console.error('Error deleting tool:', err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Gestor de Herramientas</h3>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          {showCreateForm ? 'Cancelar' : '+ Nueva Herramienta'}
        </button>
      </div>

      {/* Error Messages */}
      {error && (
        <div className="bg-red-900 bg-opacity-30 border border-red-700 text-red-200 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <form onSubmit={handleCreateTool} className="bg-[#2a2a2a] border border-[#444] rounded p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Nombre de la Herramienta
            </label>
            <input
              type="text"
              value={newToolName}
              onChange={(e) => setNewToolName(e.target.value)}
              placeholder="ej: Búsqueda Web"
              className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#555] rounded text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Descripción
            </label>
            <input
              type="text"
              value={newToolDescription}
              onChange={(e) => setNewToolDescription(e.target.value)}
              placeholder="Descripción breve de la herramienta"
              className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#555] rounded text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              JSON Schema
            </label>
            <textarea
              value={newToolSchema}
              onChange={(e) => {
                setNewToolSchema(e.target.value);
                validateJsonSchema(e.target.value);
              }}
              placeholder='{"type": "object", "properties": {...}}'
              rows={6}
              className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#555] rounded text-white text-xs font-mono focus:outline-none focus:border-blue-500"
            />
            {schemaError && (
              <p className="text-red-400 text-xs mt-1">{schemaError}</p>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-2 bg-[#1e1e1e] border border-[#555] text-gray-300 text-sm rounded hover:bg-[#252525]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creando...' : 'Crear Herramienta'}
            </button>
          </div>
        </form>
      )}

      {/* Tools List */}
      <div className="space-y-2">
        {tools.length === 0 ? (
          <p className="text-gray-400 text-sm">No hay herramientas creadas aún</p>
        ) : (
          tools.map((tool) => (
            <div
              key={tool.id}
              className="bg-[#2a2a2a] border border-[#444] rounded p-3 hover:border-[#555] transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="font-medium text-white text-sm">{tool.name}</h4>
                  {tool.description && (
                    <p className="text-gray-400 text-xs mt-1">{tool.description}</p>
                  )}
                  <details className="mt-2">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                      Ver JSON Schema
                    </summary>
                    <pre className="bg-[#1e1e1e] border border-[#555] rounded p-2 mt-2 text-xs text-gray-300 overflow-x-auto">
                      {JSON.stringify(JSON.parse(tool.jsonSchema), null, 2)}
                    </pre>
                  </details>
                </div>
                <button
                  onClick={() => handleDeleteTool(tool.id)}
                  className="ml-2 px-2 py-1 bg-red-900 bg-opacity-30 text-red-400 text-xs rounded hover:bg-opacity-50"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
