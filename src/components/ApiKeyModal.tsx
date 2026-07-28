import React, { useState } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (key: any) => void;
}

export default function ApiKeyModal({ isOpen, onClose, onSuccess }: ApiKeyModalProps) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiProvider, setApiProvider] = useState('openai');
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const providers = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'groq', label: 'Groq' },
    { value: 'custom', label: 'Custom API' },
  ];

  const handleValidateKey = async () => {
    if (!apiKey.trim()) {
      setError('Por favor ingresa una API Key');
      return;
    }

    setValidating(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch(`${API_BASE}/api/keys/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          provider: apiProvider,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'La API Key no es válida');
      }

      setSuccess('✓ API Key validada correctamente');
    } catch (err: any) {
      setError(err.message || 'Error al validar la API Key');
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !apiKey.trim()) {
      setError('El nombre y la API Key son requeridos');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          apiKey: apiKey.trim(),
          provider: apiProvider,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al guardar la API Key');
      }

      const result = await response.json();
      onSuccess(result);
      setName('');
      setApiKey('');
      setApiProvider('openai');
      setSuccess('');
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
      <div className="bg-[#1e1e1e] rounded-lg shadow-xl max-w-lg w-full mx-4 border border-[#333]">
        {/* Header */}
        <div className="bg-[#252525] border-b border-[#333] px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Nueva API Key</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-900 bg-opacity-30 border border-red-700 text-red-200 px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-900 bg-opacity-30 border border-green-700 text-green-200 px-4 py-3 rounded text-sm">
              {success}
            </div>
          )}

          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Nombre de la Clave
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ej: Mi clave OpenAI"
              className="w-full px-4 py-2 bg-[#2a2a2a] border border-[#444] rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Proveedor */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Proveedor de API
            </label>
            <select
              value={apiProvider}
              onChange={(e) => setApiProvider(e.target.value)}
              className="w-full px-4 py-2 bg-[#2a2a2a] border border-[#444] rounded text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              {providers.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Pega tu API Key aquí"
              className="w-full px-4 py-2 bg-[#2a2a2a] border border-[#444] rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              La clave se almacenará de forma segura y encriptada
            </p>
          </div>

          {/* Botones de Acción */}
          <div className="flex gap-3 justify-end pt-4 border-t border-[#333]">
            <button
              type="button"
              onClick={handleValidateKey}
              disabled={loading || validating}
              className="px-4 py-2 bg-[#2a2a2a] border border-[#444] text-gray-300 rounded hover:bg-[#333] disabled:opacity-50 flex items-center gap-2"
            >
              {validating ? (
                <>
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                  Validando...
                </>
              ) : (
                'Validar'
              )}
            </button>
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
              disabled={loading || !success}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar Clave'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
