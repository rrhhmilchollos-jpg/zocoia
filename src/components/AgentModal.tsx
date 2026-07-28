import React, { useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

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
  const [temperatura, setTemperatura] = useState(0.7);
  const [contexto, setContexto] = useState(4096);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (agent) {
      setName(agent.name || '');
      const data = typeof agent.data === 'string' ? JSON.parse(agent.data) : agent.data || {};
      setSystemPrompt(data.systemPrompt || '');
      setTemperatura(data.temperatura || 0.7);
      setContexto(data.contexto || 4096);
    } else {
      setName('');
      setSystemPrompt('');
      setTemperatura(0.7);
      setContexto(4096);
    }
    setError('');
  }, [agent, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('El nombre del agente es requerido');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const method = agent ? 'PUT' : 'POST';
      const url = agent ? `/api/resources/${agent.id}` : '/api/resources';
      const body = {
        type: 'agente',
        name: name.trim(),
        data: {
          systemPrompt,
          temperatura,
          contexto,
          herramientasAsociadas: [],
        },
      };

      const response = await fetch(`${API_BASE}${url}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al guardar el agente');
      }

      const result = await response.json();
      onSuccess(result);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-[#1e1e1e] rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-[#333]">
        {/* Header */}
        <div className="sticky top-0 bg-[#252525] border-b border-[#333] px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {agent ? 'Editar Agente' : 'Crear Nuevo Agente'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-900 bg-opacity-30 border border-red-700 text-red-200 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* Nombre del Agente */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Nombre del Agente
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ej: Mi Agente de IA"
              className="w-full px-4 py-2 bg-[#2a2a2a] border border-[#444] rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              System Prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Define el comportamiento y personalidad del agente..."
              rows={6}
              className="w-full px-4 py-2 bg-[#2a2a2a] border border-[#444] rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono text-sm"
            />
          </div>

          {/* Hiperparámetros */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Temperatura: {temperatura.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperatura}
                onChange={(e) => setTemperatura(parseFloat(e.target.value))}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">Controla la creatividad (0=determinista, 2=muy creativo)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Tamaño de Contexto: {contexto}
              </label>
              <input
                type="number"
                min="512"
                max="32768"
                step="512"
                value={contexto}
                onChange={(e) => setContexto(parseInt(e.target.value))}
                className="w-full px-4 py-2 bg-[#2a2a2a] border border-[#444] rounded text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="flex gap-3 justify-end pt-4 border-t border-[#333]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-[#2a2a2a] border border-[#444] text-gray-300 rounded hover:bg-[#333] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Guardando...
                </>
              ) : (
                agent ? 'Actualizar' : 'Crear Agente'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
