import React, { useState } from 'react';
import { Modal, Button, Input, CopyButton, Badge, toast } from './ui';
import { useApi } from '../hooks/useApi';

interface CreatedKey {
  id: string;
  name: string;
  key: string;
  type: string;
  monthlyTokenLimit: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function ApiKeyModal({ open, onClose, onCreated }: Props) {
  const { post } = useApi();
  const [name, setName] = useState('');
  const [type, setType] = useState<'pago' | 'gratuita'>('pago');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedKey | null>(null);

  const reset = () => { setName(''); setType('pago'); setCreated(null); };

  const handleClose = () => { reset(); onClose(); };

  const handleCreate = async () => {
    if (!name.trim()) { toast('error', 'El nombre es obligatorio'); return; }
    setCreating(true);
    try {
      const data = await post<CreatedKey>('/api/keys', { name: name.trim(), type });
      setCreated(data);
      onCreated();
    } catch (e: any) {
      toast('error', e.message || 'Error al crear la clave');
    } finally {
      setCreating(false);
    }
  };

  if (created) {
    return (
      <Modal open={open} onClose={handleClose} title="Clave creada" subtitle="Cópiala ahora — no se volverá a mostrar" size="md">
        <div className="bg-amber-950/30 border border-amber-700/40 rounded-xl p-4 mb-5 flex gap-3">
          <span className="text-amber-400 text-lg shrink-0">⚠️</span>
          <p className="text-amber-300 text-xs leading-relaxed">Esta es la <strong>única vez</strong> que verás la clave completa. Guárdala en un gestor de contraseñas ahora mismo.</p>
        </div>
        <div className="bg-[#111] border border-[#333] rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{created.name}</span>
              <Badge variant={created.type === 'gratuita' ? 'amber' : 'purple'}>{created.type === 'gratuita' ? 'Gratuita' : 'Pago'}</Badge>
            </div>
            <CopyButton text={created.key} label="Copiar clave" />
          </div>
          <code className="block text-xs text-green-400 font-mono break-all bg-[#0a0a0a] rounded-lg px-3 py-2.5 mt-2">
            {created.key}
          </code>
        </div>
        {created.type === 'gratuita' && created.monthlyTokenLimit && (
          <p className="text-[11px] text-gray-500 mb-5">Límite mensual: <strong className="text-white">{created.monthlyTokenLimit.toLocaleString()} tokens</strong></p>
        )}
        <div className="flex justify-end">
          <Button onClick={handleClose}>Listo</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="Nueva clave de API" subtitle="Las claves permiten acceder a la API de Zoco IA desde aplicaciones externas" size="sm">
      <div className="space-y-5">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Nombre de la clave</label>
          <Input value={name} onChange={e => setName(e.target.value)}
            placeholder="Ej: Mi aplicación, Servidor producción..."
            onKeyDown={e => e.key === 'Enter' && handleCreate()} autoFocus />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-2">Tipo de clave</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'pago', label: 'De pago', desc: 'Sin límite de tokens', icon: '💳' },
              { value: 'gratuita', label: 'Gratuita', desc: 'Límite mensual de tokens', icon: '🎁' },
            ] as const).map(opt => (
              <div key={opt.value} onClick={() => setType(opt.value)}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${type === opt.value ? 'border-purple-500 bg-purple-950/20' : 'border-[#333] bg-[#111] hover:border-[#444]'}`}>
                <span className="text-lg block mb-1.5">{opt.icon}</span>
                <p className="text-xs font-medium text-white">{opt.label}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{opt.desc}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-[#111] border border-[#222] rounded-xl p-3.5 text-[11px] text-gray-500 space-y-1.5">
          <p className="flex gap-2"><span>🔐</span>La clave empieza siempre con <code className="text-gray-300">sk-zoco-</code></p>
          <p className="flex gap-2"><span>🔒</span>Se almacena hasheada — solo visible en la creación</p>
          {type === 'gratuita' && <p className="flex gap-2 text-amber-400"><span>⚠️</span>Las claves gratuitas tienen límite mensual de tokens</p>}
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6 pt-5 border-t border-[#222]">
        <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
        <Button onClick={handleCreate} loading={creating}>Crear clave</Button>
      </div>
    </Modal>
  );
}
