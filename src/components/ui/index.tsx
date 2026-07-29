import React, { useEffect, useRef, useState } from 'react';

/* ── Modal ── */
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}
export function Modal({ open, onClose, title, subtitle, children, size = 'md' }: ModalProps) {
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className={`relative w-full ${widths[size]} bg-[#1a1a1a] border border-[#333] rounded-2xl shadow-2xl animate-in`}>
        <div className="flex items-start justify-between p-6 border-b border-[#222]">
          <div>
            <h2 className="text-base font-bold text-white">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 ml-4 mt-0.5 text-lg leading-none">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/* ── Toast ── */
export type ToastType = 'success' | 'error' | 'info';
interface ToastMsg { id: number; type: ToastType; message: string; }
let _addToast: ((type: ToastType, msg: string) => void) | null = null;
export function toast(type: ToastType, message: string) { _addToast?.(type, message); }

export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  useEffect(() => {
    _addToast = (type, message) => {
      const id = Date.now();
      setToasts(p => [...p, { id, type, message }]);
      setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
    };
    return () => { _addToast = null; };
  }, []);
  const colors = { success: 'border-green-700/50 bg-green-950/80 text-green-300', error: 'border-red-700/50 bg-red-950/80 text-red-300', info: 'border-blue-700/50 bg-blue-950/80 text-blue-300' };
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium shadow-xl backdrop-blur-sm pointer-events-auto ${colors[t.type]}`}>
          <span className="text-base">{icons[t.type]}</span>{t.message}
        </div>
      ))}
    </div>
  );
}

/* ── Spinner ── */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ── CopyButton ── */
export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${copied ? 'border-green-700/50 bg-green-950/50 text-green-400' : 'border-[#333] bg-[#252525] text-gray-400 hover:text-gray-200 hover:border-[#555]'}`}>
      {copied ? '✓ Copiado' : `📋 ${label}`}
    </button>
  );
}

/* ── Input / Textarea / Select ── */
const inputBase = 'w-full bg-[#111] border border-[#333] rounded-lg text-gray-200 text-sm px-3 py-2.5 focus:outline-none focus:border-purple-500 placeholder-gray-600 transition-colors';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  (props, ref) => <input ref={ref} {...props} className={`${inputBase} ${props.className || ''}`} />
);
Input.displayName = 'Input';
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  (props, ref) => <textarea ref={ref} {...props} className={`${inputBase} resize-none ${props.className || ''}`} />
);
Textarea.displayName = 'Textarea';
export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} ${props.className || ''}`}>{children}</select>;
}

/* ── Badge ── */
type BadgeVariant = 'purple' | 'green' | 'red' | 'amber' | 'blue' | 'gray';
export function Badge({ variant = 'gray', children }: { variant?: BadgeVariant; children: React.ReactNode }) {
  const cls = { purple: 'bg-purple-900/40 text-purple-300 border-purple-700/40', green: 'bg-green-900/40 text-green-400 border-green-700/40', red: 'bg-red-900/40 text-red-400 border-red-700/40', amber: 'bg-amber-900/40 text-amber-400 border-amber-700/40', blue: 'bg-blue-900/40 text-blue-400 border-blue-700/40', gray: 'bg-[#252525] text-gray-400 border-[#333]' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${cls[variant]}`}>{children}</span>;
}

/* ── Button ── */
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  loading?: boolean;
  size?: 'sm' | 'md';
}
export function Button({ variant = 'primary', loading, size = 'md', children, disabled, ...props }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all disabled:opacity-40';
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' };
  const variants = { primary: 'bg-white text-black hover:bg-gray-200', secondary: 'bg-[#252525] border border-[#333] text-gray-200 hover:border-[#555] hover:text-white', danger: 'bg-red-900/30 border border-red-700/40 text-red-400 hover:bg-red-900/50', ghost: 'text-gray-400 hover:text-gray-200 hover:bg-[#1e1e1e]' };
  return (
    <button {...props} disabled={disabled || loading} className={`${base} ${sizes[size]} ${variants[variant]} ${props.className || ''}`}>
      {loading && <Spinner size={13} />}{children}
    </button>
  );
}

/* ── Slider ── */
export function Slider({ label, value, min, max, step = 0.01, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs font-mono text-purple-400">{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-[#333] rounded-full appearance-none cursor-pointer accent-purple-500" />
    </div>
  );
}

/* ── Toggle ── */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <div className={`relative w-8 h-4.5 rounded-full transition-colors ${checked ? 'bg-purple-500' : 'bg-[#333]'}`}
        style={{ height: '18px' }}
        onClick={() => onChange(!checked)}>
        <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </div>
      {label && <span className="text-xs text-gray-400">{label}</span>}
    </label>
  );
}
