import React, { useState, useEffect, useCallback } from 'react';

interface Ticket {
  id: string;
  subject: string;
  status: 'open' | 'answered' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  msg_count?: number;
  email?: string;
  nombre?: string;
  created_at: number;
  updated_at: number;
}

interface TicketMsg {
  id: string;
  content: string;
  is_staff: number;
  nombre: string;
  email: string;
  created_at: number;
}

interface TicketDetail extends Ticket {
  messages: TicketMsg[];
}

const STATUS_LABEL: Record<string, string> = { open: 'Abierto', answered: 'Respondido', closed: 'Cerrado' };
const STATUS_COLOR: Record<string, string> = { open: 'bg-blue-900/30 text-blue-400 border-blue-700/40', answered: 'bg-green-900/30 text-green-400 border-green-700/40', closed: 'bg-gray-800 text-gray-500 border-gray-700' };
const PRIORITY_LABEL: Record<string, string> = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const PRIORITY_COLOR: Record<string, string> = { low: 'text-gray-500', normal: 'text-blue-400', high: 'text-amber-400', urgent: 'text-red-400' };

function fmtDate(ts: number) { return new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }

export default function SoportePanel({ authHeaders, API_BASE, isStaff }: { authHeaders: () => Record<string, string>; API_BASE: string; isStaff: boolean }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  // Nuevo ticket
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [newPriority, setNewPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/soporte/tickets`, { headers: authHeaders() });
      if (r.ok) setTickets(await r.json());
    } finally { setLoading(false); }
  }, [authHeaders, API_BASE]);

  const loadTicket = async (id: string) => {
    const r = await fetch(`${API_BASE}/api/soporte/tickets/${id}`, { headers: authHeaders() });
    if (r.ok) setSelected(await r.json());
  };

  useEffect(() => { loadTickets(); }, [loadTickets]);

  const sendReply = async () => {
    if (!reply.trim() || !selected) return;
    setSending(true);
    try {
      const r = await fetch(`${API_BASE}/api/soporte/tickets/${selected.id}/mensajes`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ content: reply }),
      });
      if (r.ok) { setReply(''); await loadTicket(selected.id); await loadTickets(); }
    } finally { setSending(false); }
  };

  const updateStatus = async (status: string) => {
    if (!selected) return;
    await fetch(`${API_BASE}/api/soporte/tickets/${selected.id}`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status }),
    });
    await loadTicket(selected.id); await loadTickets();
  };

  const createTicket = async () => {
    if (!newSubject.trim() || !newMessage.trim()) return;
    setCreating(true);
    try {
      const r = await fetch(`${API_BASE}/api/soporte/tickets`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ subject: newSubject, message: newMessage, priority: newPriority }),
      });
      if (r.ok) { setNewSubject(''); setNewMessage(''); setShowCreate(false); await loadTickets(); }
    } finally { setCreating(false); }
  };

  return (
    <div className="max-w-5xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Soporte</h1>
          <p className="text-gray-500 text-xs mt-1">Envía una consulta al equipo de Zoco IA · Respuesta en menos de 24 h</p>
        </div>
        {!isStaff && (
          <button onClick={() => setShowCreate(v => !v)} className="bg-white text-black px-4 py-2 rounded-lg text-xs font-medium hover:bg-gray-200">
            {showCreate ? '✕ Cancelar' : '+ Nuevo ticket'}
          </button>
        )}
      </div>

      {showCreate && !isStaff && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 mb-6">
          <h2 className="text-sm font-bold text-white mb-4">Nuevo ticket de soporte</h2>
          <div className="mb-3">
            <label className="text-[10px] font-bold uppercase text-gray-500 mb-1 block">Asunto</label>
            <input value={newSubject} onChange={e => setNewSubject(e.target.value)} className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none" placeholder="Describe brevemente el problema..." />
          </div>
          <div className="mb-3">
            <label className="text-[10px] font-bold uppercase text-gray-500 mb-1 block">Prioridad</label>
            <select value={newPriority} onChange={e => setNewPriority(e.target.value as any)} className="bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none">
              <option value="low">Baja</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </div>
          <div className="mb-4">
            <label className="text-[10px] font-bold uppercase text-gray-500 mb-1 block">Descripción del problema</label>
            <textarea value={newMessage} onChange={e => setNewMessage(e.target.value)} rows={4} className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none resize-none" placeholder="Explica el problema con el mayor detalle posible..." />
          </div>
          <button onClick={createTicket} disabled={creating || !newSubject.trim() || !newMessage.trim()} className="bg-blue-600 text-white px-5 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
            {creating ? 'Enviando...' : 'Enviar ticket'}
          </button>
        </div>
      )}

      <div className="flex gap-4">
        {/* Lista de tickets */}
        <div className="w-72 shrink-0 space-y-2">
          {loading && <p className="text-gray-600 text-xs text-center py-8">Cargando...</p>}
          {!loading && tickets.length === 0 && (
            <div className="bg-[#1a1a1a] border border-dashed border-[#333] rounded-xl p-10 text-center">
              <div className="text-4xl mb-3">💬</div>
              <p className="text-gray-500 text-xs">No tienes tickets abiertos.</p>
            </div>
          )}
          {tickets.map(t => (
            <div key={t.id} onClick={() => loadTicket(t.id)} className={`bg-[#1a1a1a] border rounded-xl p-3 cursor-pointer transition-colors ${selected?.id === t.id ? 'border-blue-500/50' : 'border-[#2a2a2a] hover:border-[#3a3a3a]'}`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-xs font-bold text-white truncate">{t.subject}</p>
                <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border ${STATUS_COLOR[t.status]}`}>{STATUS_LABEL[t.status]}</span>
              </div>
              {isStaff && t.email && <p className="text-[10px] text-gray-600 truncate">{t.nombre} · {t.email}</p>}
              <div className="flex items-center justify-between mt-1">
                <span className={`text-[10px] font-medium ${PRIORITY_COLOR[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
                <span className="text-[10px] text-gray-700">{fmtDate(t.updated_at)}</span>
              </div>
              {typeof t.msg_count === 'number' && <p className="text-[10px] text-gray-700 mt-0.5">{t.msg_count} mensajes</p>}
            </div>
          ))}
        </div>

        {/* Detalle del ticket */}
        {selected ? (
          <div className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl flex flex-col" style={{ maxHeight: '70vh' }}>
            <div className="p-4 border-b border-[#2a2a2a] flex items-start justify-between">
              <div>
                <h2 className="text-sm font-bold text-white">{selected.subject}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${STATUS_COLOR[selected.status]}`}>{STATUS_LABEL[selected.status]}</span>
                  <span className={`text-[10px] font-medium ${PRIORITY_COLOR[selected.priority]}`}>{PRIORITY_LABEL[selected.priority]}</span>
                </div>
              </div>
              {isStaff && (
                <div className="flex gap-2">
                  {selected.status !== 'answered' && <button onClick={() => updateStatus('answered')} className="text-[10px] bg-green-900/30 text-green-400 border border-green-700/40 px-2 py-1 rounded hover:bg-green-900/50">Marcar respondido</button>}
                  {selected.status !== 'closed' && <button onClick={() => updateStatus('closed')} className="text-[10px] bg-gray-800 text-gray-400 border border-gray-700 px-2 py-1 rounded hover:bg-gray-700">Cerrar</button>}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(selected.messages || []).map(m => (
                <div key={m.id} className={`flex ${m.is_staff ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-4 py-3 ${m.is_staff ? 'bg-blue-900/30 border border-blue-700/30' : 'bg-[#111] border border-[#2a2a2a]'}`}>
                    <p className={`text-[10px] font-bold mb-1 ${m.is_staff ? 'text-blue-400' : 'text-gray-500'}`}>{m.is_staff ? '🛡️ Soporte Zoco IA' : m.nombre}</p>
                    <p className="text-xs text-gray-200 whitespace-pre-wrap">{m.content}</p>
                    <p className="text-[9px] text-gray-700 mt-1 text-right">{fmtDate(m.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
            {selected.status !== 'closed' && (
              <div className="p-4 border-t border-[#2a2a2a] flex gap-2">
                <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} className="flex-1 bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none resize-none" placeholder="Escribe tu respuesta..." />
                <button onClick={sendReply} disabled={sending || !reply.trim()} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50 self-end">
                  {sending ? '...' : 'Enviar'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 bg-[#1a1a1a] border border-dashed border-[#2a2a2a] rounded-xl flex items-center justify-center">
            <p className="text-gray-600 text-sm">Selecciona un ticket para ver la conversación</p>
          </div>
        )}
      </div>
    </div>
  );
}
