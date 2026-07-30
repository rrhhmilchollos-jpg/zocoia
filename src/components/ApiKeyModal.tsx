/**
 * ApiKeyModal.tsx
 * 
 * Modal profesional para la creación de claves API con validación en caliente.
 * Estilo Claude Console con Tailwind CSS.
 */

import React, { useState } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';
import { X, Key, ShieldCheck, Loader2, AlertCircle, CheckCircle2, Globe, Cpu, Zap } from 'lucide-react';

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
  const [isValidated, setIsValidated] = useState(false);

  const providers = [
    { value: 'openai', label: 'OpenAI', icon: <Cpu className="w-4 h-4" />, color: 'text-emerald-500' },
    { value: 'anthropic', label: 'Anthropic', icon: <Zap className="w-4 h-4" />, color: 'text-orange-500' },
    { value: 'groq', label: 'Groq Cloud', icon: <Zap className="w-4 h-4" />, color: 'text-purple-500' },
    { value: 'custom', label: 'Custom API', icon: <Globe className="w-4 h-4" />, color: 'text-blue-500' },
  ];

  const handleValidateKey = async () => {
    if (!apiKey.trim()) {
      setError('Por favor ingresa una API Key');
      return;
    }

    setValidating(true);
    setError('');
    setIsValidated(false);

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

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'La API Key no es válida');
      }

      setIsValidated(true);
    } catch (err: any) {
      setError(err.message || 'Error al validar la API Key');
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !apiKey.trim() || !isValidated) {
      if (!isValidated) setError('Debes validar la clave antes de guardarla');
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

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Error al guardar la API Key');
      }

      onSuccess(data);
      setName('');
      setApiKey('');
      setApiProvider('openai');
      setIsValidated(false);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-[#333] w-full max-w-lg rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#333] bg-[#222]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center border border-purple-500/20">
              <Key className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-none">Nueva API Key</h2>
              <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-widest font-bold">Vault Security v2.0</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white transition-colors rounded-lg hover:bg-[#333]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {isValidated && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-xl flex items-start space-x-3">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">Clave validada con éxito. Lista para almacenamiento seguro.</span>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Nombre de la Clave</label>
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej: Producción OpenAI"
                className="w-full bg-[#0d0d0d] border border-[#333] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Proveedor</label>
              <div className="grid grid-cols-2 gap-2">
                {providers.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => { setApiProvider(p.value); setIsValidated(false); }}
                    className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl border text-sm transition-all ${
                      apiProvider === p.value 
                        ? 'bg-purple-500/10 border-purple-500/50 text-white font-bold' 
                        : 'bg-[#0d0d0d] border-[#333] text-gray-500 hover:border-[#444]'
                    }`}
                  >
                    <span className={apiProvider === p.value ? p.color : 'text-gray-600'}>{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Valor de la Clave</label>
              <div className="relative">
                <input 
                  type="password" 
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setIsValidated(false); }}
                  placeholder="sk-..."
                  className="w-full bg-[#0d0d0d] border border-[#333] rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-purple-500/50 transition-all"
                />
                <button
                  type="button"
                  onClick={handleValidateKey}
                  disabled={validating || !apiKey.trim() || isValidated}
                  className={`absolute right-2 top-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${
                    isValidated 
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                      : 'bg-purple-500 text-white hover:bg-purple-400 shadow-lg shadow-purple-500/20 disabled:opacity-50'
                  }`}
                >
                  {validating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isValidated ? 'Validada ✓' : 'Validar'}
                </button>
              </div>
              <p className="text-[10px] text-gray-600 mt-2 flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3" />
                <span>La clave será encriptada con AES-256-GCM antes de guardarse.</span>
              </p>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-[#333]">
            <button 
              type="button" 
              onClick={onClose}
              className="px-6 py-2.5 text-sm font-medium text-gray-400 hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              disabled={loading || !isValidated}
              className="bg-white text-black hover:bg-gray-200 px-8 py-2.5 rounded-xl font-bold text-sm shadow-lg transition-all disabled:opacity-30 disabled:grayscale"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Guardar en Vault'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
