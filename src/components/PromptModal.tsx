// src/components/PromptModal.tsx
// Sustituye window.prompt() por un modal controlado. Se integra en Dashboard.tsx
// para handleAdminTopup() y renameSession() tal como se acordó.

import { useState, useEffect } from 'react';

interface PromptModalProps {
  open: boolean;
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  inputType?: 'text' | 'number';
  onCancel: () => void;
  onConfirm: (value: string) => Promise<void> | void;
}

export default function PromptModal({
  open, title, label, initialValue = '', confirmLabel = 'Confirmar',
  inputType = 'text', onCancel, onConfirm,
}: PromptModalProps) {
  const [value, setValue] = useState(initialValue);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setValue(initialValue); setError(null); }
  }, [open, initialValue]);

  if (!open) return null;

  const confirm = async () => {
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onConfirm(value.trim());
    } catch (e: any) {
      setError(e?.message || 'No se pudo completar la acción. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl
                      transition-all duration-150 ease-out">
        <div className="px-5 py-4 border-b border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
        </div>
        <div className="px-5 py-4 space-y-2">
          {label && <label className="text-xs text-neutral-400">{label}</label>}
          <input
            autoFocus
            type={inputType}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirm()}
            className="w-full rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm
                       text-neutral-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-neutral-800 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded-md text-neutral-300 hover:bg-neutral-800">
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={loading || !value.trim()}
            className="px-3 py-1.5 text-sm rounded-md bg-orange-600 hover:bg-orange-500
                       disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            {loading ? 'Guardando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
