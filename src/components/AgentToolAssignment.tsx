import React, { useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

interface Tool {
  id: string;
  name: string;
  description: string;
}

interface AgentToolAssignmentProps {
  agentId: string;
  onUpdate?: (toolIds: string[]) => void;
}

export default function AgentToolAssignment({ agentId, onUpdate }: AgentToolAssignmentProps) {
  const { token } = useAuth();
  const [availableTools, setAvailableTools] = useState<Tool[]>([]);
  const [assignedToolIds, setAssignedToolIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadToolsAndAssignments();
  }, [agentId]);

  const loadToolsAndAssignments = async () => {
    try {
      setLoading(true);
      setError('');

      // Load all available tools
      const toolsResponse = await fetch(`${API_BASE}/api/resources?type=habilidad`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (toolsResponse.ok) {
        const toolsData = await toolsResponse.json();
        setAvailableTools(
          toolsData.map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.data?.description || '',
          }))
        );
      }

      // Load agent's assigned tools
      const agentResponse = await fetch(`${API_BASE}/api/resources/${agentId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (agentResponse.ok) {
        const agentData = await agentResponse.json();
        const data = typeof agentData.data === 'string' ? JSON.parse(agentData.data) : agentData.data || {};
        const assigned = data.herramientasAsociadas || [];
        setAssignedToolIds(new Set(assigned));
      }
    } catch (err: any) {
      setError('Error al cargar herramientas');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleTool = (toolId: string) => {
    const newAssigned = new Set(assignedToolIds);
    if (newAssigned.has(toolId)) {
      newAssigned.delete(toolId);
    } else {
      newAssigned.add(toolId);
    }
    setAssignedToolIds(newAssigned);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/resources/${agentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          data: {
            herramientasAsociadas: Array.from(assignedToolIds),
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al guardar herramientas');
      }

      onUpdate?.(Array.from(assignedToolIds));
    } catch (err: any) {
      setError(err.message || 'Error desconocido');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Asignar Herramientas</h3>
      </div>

      {/* Error Messages */}
      {error && (
        <div className="bg-red-900 bg-opacity-30 border border-red-700 text-red-200 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      {/* Tools List */}
      <div className="space-y-2">
        {availableTools.length === 0 ? (
          <p className="text-gray-400 text-sm">No hay herramientas disponibles. Crea una en el Gestor de Herramientas.</p>
        ) : (
          availableTools.map((tool) => (
            <label
              key={tool.id}
              className="flex items-start gap-3 p-3 bg-[#2a2a2a] border border-[#444] rounded hover:border-[#555] cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={assignedToolIds.has(tool.id)}
                onChange={() => toggleTool(tool.id)}
                className="mt-1 w-4 h-4 cursor-pointer"
              />
              <div className="flex-1">
                <h4 className="font-medium text-white text-sm">{tool.name}</h4>
                {tool.description && (
                  <p className="text-gray-400 text-xs mt-0.5">{tool.description}</p>
                )}
              </div>
            </label>
          ))
        )}
      </div>

      {/* Save Button */}
      {availableTools.length > 0 && (
        <div className="flex gap-2 justify-end pt-4 border-t border-[#333]">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Guardando...
              </>
            ) : (
              'Guardar Cambios'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
