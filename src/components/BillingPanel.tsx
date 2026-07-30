import React, { useState, useEffect } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';

interface UsageRecord {
  id: string;
  resource_name: string;
  resource_type: string;
  amount: number;
  cost: number;
  created_at: string;
}

interface BillingSummary {
  creditos: number;
  gastoEsteMes: number;
  recursos: Record<string, number>;
  clavesActivas: number;
}

export default function BillingPanel() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const authHeaders = () => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [resSummary, resUsage] = await Promise.all([
        fetch(`${API_BASE}/api/billing/summary`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/billing/usage`, { headers: authHeaders() })
      ]);
      
      if (resSummary.ok) setSummary(await resSummary.json());
      if (resUsage.ok) setUsage(await resUsage.json());
    } catch (e) {
      console.error("Error loading billing data:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddFunds = async (amount: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/revolut/create-order`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ amount })
      });
      const data = await res.json();
      if (data.public_id) {
        // @ts-ignore
        RevolutCheckout(data.public_id).then(function (RC) {
          RC.payWithPopup({
            onSuccess() {
              alert("¡Pago completado con éxito!");
              loadData();
            },
            onError(error: any) {
              alert("Error en el pago: " + error.message);
            }
          });
        });
      }
    } catch (e) {
      alert("Error al iniciar el pago con Revolut");
    }
  };

  if (loading) return <div className="p-8 text-gray-500 animate-pulse">Cargando facturación...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold text-white tracking-tight">Facturación</h1>
        <p className="text-gray-500 text-sm mt-1">Gestiona tus créditos y consulta el consumo detallado de tus servicios.</p>
      </header>

      {/* BALANCE CARD */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-6 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="text-6xl">💰</span>
          </div>
          <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Saldo Disponible</div>
          <div className="text-4xl font-black text-white mb-4">
            {(summary?.creditos ?? 0).toFixed(2)} €
          </div>
          <div className="flex gap-2">
            {[10, 25, 50].map(amt => (
              <button 
                key={amt}
                onClick={() => handleAddFunds(amt)}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg py-2 text-xs font-bold text-white transition-all active:scale-95"
              >
                +{amt}€
              </button>
            ))}
          </div>
        </div>

        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-6 shadow-xl">
          <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Gasto Mensual</div>
          <div className="text-4xl font-black text-purple-400 mb-1">
            {(summary?.gastoEsteMes ?? 0).toFixed(2)} €
          </div>
          <p className="text-[10px] text-gray-500 italic">Calculado en base al uso real de recursos</p>
        </div>

        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-6 shadow-xl">
          <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2">Infraestructura</div>
          <div className="space-y-2 mt-4">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-500">Agentes Activos</span>
              <span className="text-white font-mono">{summary?.recursos?.agente ?? 0}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-500">Claves de API</span>
              <span className="text-white font-mono">{summary?.clavesActivas ?? 0}</span>
            </div>
            <div className="w-full bg-white/5 h-1.5 rounded-full mt-4">
              <div className="bg-purple-500 h-full rounded-full" style={{ width: '45%' }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* USAGE TABLE - RAILWAY STYLE */}
      <div className="bg-[#151515] border border-[#222] rounded-2xl overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-[#222] flex justify-between items-center bg-[#1a1a1a]/50">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest">Desglose de Servicios (Pay-per-use)</h2>
          <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-bold border border-green-500/20">En vivo</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-tighter border-b border-[#222]">
                <th className="px-6 py-3 font-black">Recurso</th>
                <th className="px-6 py-3 font-black">Tipo</th>
                <th className="px-6 py-3 font-black">Consumo</th>
                <th className="px-6 py-3 font-black text-right">Coste</th>
                <th className="px-6 py-3 font-black text-right">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222]">
              {usage.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-600 text-xs italic">
                    No hay registros de uso todavía. Los cargos aparecerán aquí en tiempo real.
                  </td>
                </tr>
              ) : (
                usage.map(item => (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]"></div>
                        <span className="text-white font-medium text-xs">{item.resource_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[10px] bg-[#222] text-gray-400 px-2 py-0.5 rounded border border-[#333] font-mono">
                        {item.resource_type.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-400 font-mono">
                      {item.amount.toLocaleString()} units
                    </td>
                    <td className="px-6 py-4 text-right text-xs font-bold text-white">
                      {item.cost.toFixed(4)} €
                    </td>
                    <td className="px-6 py-4 text-right text-[10px] text-gray-500">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* REVOLUT BANNER */}
      <div className="bg-gradient-to-r from-blue-600/10 to-purple-600/10 border border-blue-500/20 rounded-2xl p-6 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="bg-white p-2 rounded-lg">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Revolut_logo.svg/1200px-Revolut_logo.svg.png" alt="Revolut" className="h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Pagos Seguros con Revolut Business</h3>
            <p className="text-xs text-gray-500">Tus transacciones están protegidas por encriptación bancaria de nivel militar.</p>
          </div>
        </div>
        <button className="text-xs text-blue-400 hover:text-blue-300 font-bold uppercase tracking-widest">Saber más →</button>
      </div>
    </div>
  );
}
