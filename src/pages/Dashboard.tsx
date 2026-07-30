import React, { useState, useEffect, useRef } from 'react';
import { useAuth, API_BASE } from '../context/AuthContext';
import ManusAgentPanel from '../components/ManusAgentPanel';
import AgentModal from '../components/AgentModal';
import ToolboxPanel from '../components/ToolboxPanel';
import OrdenadorZocoPanel from '../components/OrdenadorZocoPanel';
import ApiKeyTable from '../components/ApiKeyTable';
import ApiKeyModal from '../components/ApiKeyModal';
import BillingPanel from '../components/BillingPanel';

interface Recurso { id: string; type: string; name: string; data: Record<string, any>; createdAt: string; }
interface ApiKey { id: string; name: string; display: string; revoked: boolean; createdAt: string; }
interface AdminUsuario { id: string; email: string; nombre: string; isAdmin: boolean; isSupport: boolean; creditos: number; activo: boolean; createdAt: string; }
interface BillingSummary { creditos: number; gastoEsteMes: number; recursos: Record<string, number>; clavesActivas: number; }
interface MemoriaMensaje { id: string; role: string; content: string; created_at: string; }
interface Payment { id: string; amount: number; credits: number; status: string; created_at: string; }
interface CreditPack { id: string; euros: number; credits: number; label: string; }
interface ChatMsg { role: string; content: string; cacheReadTokens?: number; }

function fmtEUR(n: number) { return `${(n || 0).toFixed(2)} €`; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('es-ES'); }

const MODELOS = [
  { nombre: 'Zoco-Flash', backend: 'zoco-flash', badge: null, ollamaModel: 'OLLAMA_MODEL_FLASH', tags: ['Más rápido','Menor coste','Alto volumen'], color: 'from-teal-400 to-emerald-500', icon: '⚡' },
  { nombre: 'Zoco-Plus', backend: 'zoco-plus', badge: null, ollamaModel: 'OLLAMA_MODEL_PLUS', tags: ['Tareas cotidianas','Escritura','Rentable'], color: 'from-gray-500 to-slate-600', icon: '✳' },
  { nombre: 'Zoco-Max', backend: 'zoco-max', badge: null, ollamaModel: 'OLLAMA_MODEL_MAX', tags: ['Proyectos complejos','Agentes','Programación'], color: 'from-orange-400 to-rose-500', icon: '◈' },
  { nombre: 'Zoco-Lab', backend: 'zoco-lab', badge: 'Beta', ollamaModel: 'OLLAMA_MODEL_LAB', tags: ['Experimental','Investigación','Nuevas capacidades'], color: 'from-purple-500 to-indigo-600', icon: '✦' },
];

const RESOURCE_SECTIONS = [
  { key: 'archivo', label: 'Archivos', icon: '📁' },
  { key: 'habilidad', label: 'Habilidades', icon: '⚡' },
  { key: 'lote', label: 'Lotes', icon: '📦' },
  { key: 'sesion', label: 'Sesiones', icon: '💬' },
  { key: 'implementacion', label: 'Implementaciones', icon: '🚀' },
  { key: 'entorno', label: 'Entornos', icon: '🌐' },
  { key: 'credencial', label: 'Almacén de credenciales', icon: '🔒' },
  { key: 'memoria', label: 'Almacenes de memoria', icon: '🧠' },
];

export default function Dashboard() {
  const { user, token, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('panel');
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [agentes, setAgentes] = useState<Recurso[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [resourcesByType, setResourcesByType] = useState<Record<string, Recurso[]>>({});
  const [selectedModel, setSelectedModel] = useState('zoco-plus');
  
  // Modales
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Recurso | null>(null);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState<Recurso | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const authHeaders = () => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });

  useEffect(() => {
    if (activeTab === 'panel' || activeTab === 'billing') loadBilling();
    if (activeTab === 'panel' || activeTab === 'agentes' || activeTab === 'mis-agentes') loadAgentes();
    if (activeTab === 'keys') loadKeys();
  }, [activeTab]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const loadBilling = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/billing/summary`, { headers: authHeaders() });
      if (r.ok) setBilling(await r.json());
    } catch (e) {}
  };

  const loadAgentes = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/resources?type=agente`, { headers: authHeaders() });
      if (r.ok) setAgentes(await r.json());
    } catch (e) {}
  };

  const loadKeys = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/keys`, { headers: authHeaders() });
      if (r.ok) setKeys(await r.json());
    } catch (e) {}
  };

  const sendChat = async () => {
    const msg = chatInput.trim(); 
    if (!msg || chatLoading) return;
    
    setChatInput('');
    const newMessages: ChatMsg[] = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(newMessages);
    setChatLoading(true);
    
    try {
      const r = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: 'POST', 
        headers: authHeaders(),
        body: JSON.stringify({
          messages: newMessages,
          model: selectedModel,
          agentId: activeAgent?.id,
        }),
      });
      
      const d = await r.json();
      if (r.ok) {
        const assistantMsg: ChatMsg = { 
          role: 'assistant', 
          content: d.choices?.[0]?.message?.content || '',
          cacheReadTokens: d.usage?.cache_read_tokens || 0
        };
        setChatMessages(prev => [...prev, assistantMsg]);
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${d.error || 'Sin respuesta'}` }]);
      }
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error de conexión con el servidor.' }]);
    } finally { 
      setChatLoading(false); 
      loadBilling(); // Actualizar saldo
    }
  };

  const handleCreateAgent = () => {
    setEditingAgent(null);
    setAgentModalOpen(true);
  };

  const handleEditAgent = (agente: Recurso) => {
    setEditingAgent(agente);
    setAgentModalOpen(true);
  };

  const handleCreateKey = () => {
    setApiKeyModalOpen(true);
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('¿Estás seguro de que quieres revocar esta clave?')) return;
    try {
      const r = await fetch(`${API_BASE}/api/keys/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (r.ok) loadKeys();
    } catch (e) {}
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    alert('Clave copiada al portapapeles');
  };

  const balance = billing?.creditos ?? 0;
  const balanceLow = balance < 1;

  const NavItem = ({ tab, label, icon }: { tab: string; label: string; icon: string }) => (
    <button onClick={() => setActiveTab(tab)}
      className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-left text-[13px] transition-colors ${activeTab === tab ? 'bg-[#2a2a2a] text-white font-medium' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1e1e1e]'}`}>
      <span className="text-base">{icon}</span><span>{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-[#111111] text-gray-200 font-sans overflow-hidden text-sm">
      {/* SIDEBAR */}
      <aside className="w-60 bg-[#151515] border-r border-[#222] flex flex-col shrink-0 h-full overflow-y-auto">
        <div className="p-3 flex items-center space-x-2 border-b border-[#222]">
          <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-blue-600 rounded flex items-center justify-center text-white text-xs font-bold">Z</div>
          <span className="font-semibold text-white text-sm">Zoco IA Console</span>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          <NavItem tab="panel" label="Panel de control" icon="🏠" />
          <NavItem tab="keys" label="Claves de API" icon="🔑" />
          <NavItem tab="chat" label="Chat IA" icon="💬" />
          <NavItem tab="billing" label="Facturación" icon="💳" />

          <div className="pt-3">
            <div className="px-3 py-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Compilar</div>
            <NavItem tab="archivo" label="Archivos" icon="📁" />
            <NavItem tab="habilidad" label="Habilidades" icon="⚡" />
            <NavItem tab="lote" label="Lotes" icon="📦" />
          </div>

          <div className="pt-2">
            <div className="px-3 py-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Agentes gestionados</div>
            <NavItem tab="agentes" label="Inicio rápido" icon="🚀" />
            <NavItem tab="mis-agentes" label="Agentes" icon="🤖" />
            <NavItem tab="manus-agent" label="Agente Autónomo" icon="🧠" />
            <NavItem tab="sesion" label="Sesiones" icon="💬" />
            <NavItem tab="entorno" label="Entornos" icon="🌐" />
          </div>
          
          <div className="pt-2">
            <div className="px-3 py-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Administración</div>
            <NavItem tab="admin" label="Panel Admin" icon="🛡️" />
            <NavItem tab="manus-computer" label="Ordenador de Zoco" icon="🖥️" />
          </div>

          <div className="pt-2">
            <NavItem tab="docs" label="Documentación" icon="📖" />
          </div>
        </nav>

        <div className="border-t border-[#222] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0">
              <div className="w-7 h-7 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0">
                {(user?.nombre || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-white leading-tight truncate text-xs">{user?.nombre || 'Usuario'}</p>
                <p className="text-[10px] text-gray-500">{user?.isAdmin ? '👑 Admin' : 'Cliente'}</p>
              </div>
            </div>
            <button onClick={logout} title="Cerrar sesión" className="text-gray-600 hover:text-red-400 text-xs ml-1">⏏</button>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className={`font-bold ${balanceLow ? 'text-amber-400' : 'text-green-400'}`}>{fmtEUR(balance)}</span>
            <button onClick={() => setActiveTab('billing')} className="text-purple-400 hover:text-purple-300">+ Añadir fondos</button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 overflow-y-auto h-full bg-[#111111]">
        <div className="p-8">
          {activeTab === 'panel' && (
            <>
              <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold text-white">Buenos días, {user?.nombre?.split(' ')[0] || 'Maria'}</h1>
                <div className="flex items-center space-x-2">
                  <button onClick={() => setActiveTab('docs')} className="px-3 py-1.5 border border-[#333] rounded-lg text-gray-400 hover:text-gray-200 text-xs">📖 Documentación</button>
                  <button onClick={handleCreateKey} className="px-3 py-1.5 border border-[#333] rounded-lg text-gray-400 hover:text-gray-200 text-xs">🔑 Obtener clave</button>
                  <button onClick={handleCreateAgent} className="px-3 py-1.5 bg-white text-black rounded-lg font-medium hover:bg-gray-200 text-xs">🤖 Crear agente</button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
                  <div className="text-gray-500 text-xs mb-2">Créditos de la organización</div>
                  <div className={`text-2xl font-bold ${balanceLow ? 'text-amber-400' : 'text-white'}`}>{fmtEUR(balance)}</div>
                  <button onClick={() => setActiveTab('billing')} className="text-purple-400 text-xs hover:underline mt-2 block">Añadir fondos →</button>
                </div>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
                  <div className="text-gray-500 text-xs mb-2">Gasto este mes</div>
                  <div className="text-2xl font-bold text-white">{fmtEUR(billing?.gastoEsteMes ?? 0)}</div>
                </div>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
                  <div className="text-gray-500 text-xs mb-2">Claves activas</div>
                  <div className="text-2xl font-bold text-white">{keys.length}</div>
                </div>
              </div>

              <h2 className="text-base font-bold text-white mb-4">Modelos</h2>
              <div className="grid grid-cols-4 gap-4">
                {MODELOS.map(m => (
                  <div key={m.nombre} onClick={() => { setSelectedModel(m.backend); setActiveTab('chat'); }} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 cursor-pointer hover:border-purple-500/50 transition-all">
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xl p-2 rounded-lg bg-gradient-to-br ${m.color} text-white`}>{m.icon}</span>
                      {m.badge && <span className="bg-purple-900/50 text-purple-300 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">{m.badge}</span>}
                    </div>
                    <h3 className="font-bold text-white mb-1">{m.nombre}</h3>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {m.tags.map(t => <span key={t} className="text-[9px] bg-[#222] text-gray-500 px-1.5 py-0.5 rounded">{t}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'chat' && (
            <div className="max-w-4xl mx-auto h-[calc(100vh-100px)] flex flex-col">
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-[#222]">
                <div className="flex items-center space-x-3">
                  <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} className="bg-[#1a1a1a] border border-[#333] text-white text-xs rounded-lg px-3 py-1.5 outline-none focus:border-purple-500">
                    {MODELOS.map(m => <option key={m.backend} value={m.backend}>{m.nombre}</option>)}
                  </select>
                  {activeAgent && <span className="text-xs bg-purple-900/30 text-purple-300 px-2 py-1 rounded-full border border-purple-800/50">🤖 {activeAgent.name}</span>}
                </div>
                <button onClick={() => setChatMessages([])} className="text-xs text-gray-500 hover:text-gray-300">Limpiar chat</button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 scrollbar-thin scrollbar-thumb-[#333]">
                {chatMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 opacity-50">
                    <div className="text-5xl mb-4">Z</div>
                    <p className="text-sm">Zoco IA listo para ayudarte</p>
                  </div>
                )}
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-[13px] leading-relaxed ${m.role === 'user' ? 'bg-purple-600 text-white rounded-br-sm' : 'bg-[#1a1a1a] text-gray-200 rounded-bl-sm border border-[#2a2a2a]'}`}>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                      {m.cacheReadTokens ? (
                        <div className="mt-2 pt-2 border-t border-white/10 flex items-center space-x-1.5 text-[10px] text-purple-300 font-bold uppercase tracking-wider">
                          <span className="animate-pulse">✦</span>
                          <span>Prompt Cache: {m.cacheReadTokens} tokens ahorrados</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] px-4 py-3 rounded-2xl rounded-bl-sm text-sm text-gray-500">
                      <span className="flex space-x-1"><span className="animate-bounce">.</span><span className="animate-bounce delay-100">.</span><span className="animate-bounce delay-200">.</span></span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="relative">
                <textarea 
                  value={chatInput} 
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendChat())}
                  placeholder="Escribe tu mensaje aquí..."
                  className="w-full bg-[#1a1a1a] border border-[#333] text-white rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:border-purple-500 min-h-[50px] max-h-[200px] resize-none"
                />
                <button 
                  onClick={sendChat} 
                  disabled={chatLoading || !chatInput.trim()}
                  className="absolute right-3 bottom-3 text-purple-500 hover:text-purple-400 disabled:opacity-30"
                >
                  ➤
                </button>
              </div>
            </div>
          )}

          {activeTab === 'keys' && (
            <div className="max-w-5xl">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h1 className="text-2xl font-bold text-white">Claves de API</h1>
                  <p className="text-gray-500 text-xs mt-1">Gestión de acceso programático para tus aplicaciones</p>
                </div>
                <button onClick={handleCreateKey} className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-purple-500/20 transition-all">+ Nueva Clave</button>
              </div>
              <ApiKeyTable keys={keys} onDelete={handleDeleteKey} onCopy={handleCopyKey} />
            </div>
          )}

          {activeTab === 'billing' && <BillingPanel />}

          {activeTab === 'habilidad' && <ToolboxPanel />}
          {activeTab === 'manus-agent' && <ManusAgentPanel />}
          {activeTab === 'manus-computer' && <OrdenadorZocoPanel />}
          {activeTab === 'mis-agentes' && (
            <div className="grid grid-cols-3 gap-4">
              {agentes.map(a => (
                <div key={a.id} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5 hover:border-purple-500/50 transition-all cursor-pointer" onClick={() => { setActiveAgent(a); setActiveTab('chat'); }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xl p-2 rounded-lg bg-[#222]">{a.name.charAt(0).toUpperCase()}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleEditAgent(a); }} className="text-[10px] text-gray-500 hover:text-white uppercase font-bold tracking-widest">Configurar</button>
                  </div>
                  <h3 className="font-bold text-white mb-1">{a.name}</h3>
                  <p className="text-[11px] text-gray-500 line-clamp-2">{(a.data as any)?.systemPrompt || 'Sin descripción'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* MODALES */}
      <AgentModal 
        isOpen={agentModalOpen} 
        onClose={() => setAgentModalOpen(false)} 
        onSave={() => { setAgentModalOpen(false); loadAgentes(); }}
        editingAgent={editingAgent}
      />
      <ApiKeyModal 
        isOpen={apiKeyModalOpen} 
        onClose={() => setApiKeyModalOpen(false)} 
        onSave={() => { setApiKeyModalOpen(false); loadKeys(); }}
      />
    </div>
  );
}
