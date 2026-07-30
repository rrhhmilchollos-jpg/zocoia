/**
 * ApiKeyTable.tsx
 * 
 * Tabla profesional para la gestión de claves API.
 * Implementa enmascaramiento seguro y copiado al portapapeles.
 */

import React, { useState } from 'react';
import { Key, Copy, Check, Trash2, Calendar, ShieldCheck, ExternalLink } from 'lucide-react';

interface ApiKey {
  id: string;
  name: string;
  display: string;
  provider?: string;
  revoked: boolean;
  createdAt: string;
}

interface ApiKeyTableProps {
  keys: ApiKey[];
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
}

export default function ApiKeyTable({ keys, onDelete, onCopy }: ApiKeyTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string) => {
    onCopy(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl overflow-hidden shadow-xl">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-[#222] border-b border-[#333]">
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Identificador</th>
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Clave (Enmascarada)</th>
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Proveedor</th>
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Creada</th>
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#222]">
          {keys.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center text-gray-600">
                <div className="flex flex-col items-center">
                  <Key className="w-12 h-12 mb-3 opacity-20" />
                  <p>No se han generado claves de API todavía.</p>
                </div>
              </td>
            </tr>
          ) : keys.map((k) => (
            <tr key={k.id} className="hover:bg-[#1e1e1e] transition-colors group">
              <td className="px-6 py-4">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center border border-purple-500/20">
                    <ShieldCheck className="w-4 h-4 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{k.name}</p>
                    <p className="text-[10px] text-gray-600 font-mono">{k.id.slice(0, 8)}</p>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center space-x-3">
                  <code className="bg-[#0d0d0d] border border-[#333] px-3 py-1.5 rounded-lg text-xs text-gray-400 font-mono tracking-wider">
                    {k.display}
                  </code>
                  {!k.revoked && (
                    <button 
                      onClick={() => handleCopy(k.id)}
                      className={`p-1.5 rounded-md transition-all ${copiedId === k.id ? 'text-emerald-500 bg-emerald-500/10' : 'text-gray-600 hover:text-white hover:bg-[#333]'}`}
                      title="Copiar máscara"
                    >
                      {copiedId === k.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </td>
              <td className="px-6 py-4">
                <span className="text-[10px] bg-[#222] px-2 py-0.5 rounded text-gray-400 uppercase tracking-tighter border border-[#333]">
                  {k.provider || 'System'}
                </span>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center text-gray-500 space-x-2">
                  <Calendar className="w-3.5 h-3.5" />
                  <span className="text-xs">{fmtDate(k.createdAt)}</span>
                </div>
              </td>
              <td className="px-6 py-4 text-right">
                <div className="flex items-center justify-end space-x-2">
                  <button 
                    onClick={() => {
                      if (confirm('¿Revocar esta clave? Esta acción no se puede deshacer.')) {
                        onDelete(k.id);
                      }
                    }}
                    className="p-2 text-gray-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                    title="Revocar clave"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bg-[#151515] px-6 py-3 border-t border-[#2a2a2a] flex items-center justify-between">
        <p className="text-[10px] text-gray-600 uppercase tracking-tighter font-medium">
          Seguridad: Encriptación AES-256-GCM activada
        </p>
        <div className="flex items-center space-x-1">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
          <span className="text-[10px] text-emerald-500/70 font-bold uppercase tracking-widest">Vault Secure</span>
        </div>
      </div>
    </div>
  );
}
