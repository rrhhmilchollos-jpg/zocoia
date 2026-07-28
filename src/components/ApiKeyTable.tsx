import React, { useState } from 'react';

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
  loading?: boolean;
}

export default function ApiKeyTable({ keys, onDelete, onCopy, loading }: ApiKeyTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (id: string) => {
    onCopy(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (keys.length === 0) {
    return (
      <div className="bg-[#2a2a2a] border border-[#444] rounded p-8 text-center">
        <p className="text-gray-400">No hay claves de API creadas aún</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#333] bg-[#1e1e1e]">
            <th className="px-4 py-3 text-left font-medium text-gray-300">Nombre</th>
            <th className="px-4 py-3 text-left font-medium text-gray-300">Clave</th>
            <th className="px-4 py-3 text-left font-medium text-gray-300">Proveedor</th>
            <th className="px-4 py-3 text-left font-medium text-gray-300">Creada</th>
            <th className="px-4 py-3 text-left font-medium text-gray-300">Estado</th>
            <th className="px-4 py-3 text-right font-medium text-gray-300">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr
              key={key.id}
              className="border-b border-[#333] hover:bg-[#1e1e1e] transition-colors"
            >
              <td className="px-4 py-3 text-white">{key.name}</td>
              <td className="px-4 py-3">
                <code className="bg-[#1e1e1e] px-2 py-1 rounded text-xs text-gray-300 font-mono">
                  {key.display}
                </code>
              </td>
              <td className="px-4 py-3 text-gray-400 capitalize">
                {key.provider || 'N/A'}
              </td>
              <td className="px-4 py-3 text-gray-400">
                {formatDate(key.createdAt)}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    key.revoked
                      ? 'bg-red-900 bg-opacity-30 text-red-300'
                      : 'bg-green-900 bg-opacity-30 text-green-300'
                  }`}
                >
                  {key.revoked ? 'Revocada' : 'Activa'}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  {!key.revoked && (
                    <button
                      onClick={() => handleCopy(key.id)}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        copiedId === key.id
                          ? 'bg-green-900 bg-opacity-30 text-green-300'
                          : 'bg-[#2a2a2a] text-gray-300 hover:bg-[#333]'
                      }`}
                      title="Copiar clave al portapapeles"
                    >
                      {copiedId === key.id ? '✓ Copiada' : 'Copiar'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm('¿Revocar esta clave? Esta acción no se puede deshacer.')) {
                        onDelete(key.id);
                      }
                    }}
                    disabled={loading}
                    className="px-2 py-1 bg-red-900 bg-opacity-30 text-red-400 text-xs rounded hover:bg-opacity-50 disabled:opacity-50 transition-colors"
                  >
                    Revocar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
