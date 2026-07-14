import React, { useState, useEffect } from 'react';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface ApiKey {
  id: number;
  nombre: string;
  token: string;
  limite: string;
  estado: 'Activa' | 'Suspendida';
  uso: number;
  creada: string;
}

interface Agente {
  id: string;
  nombre: string;
  modelo: string;
  estado: 'activo' | 'inactivo' | 'error';
  sesiones: number;
  ultimaActividad: string;
}

interface Sesion {
  id: string;
  agente: string;
  inicio: string;
  tokens: number;
  estado: 'completada' | 'activa' | 'error';
}

interface ModeloInfraestructura {
  id: string;
  nombre: string;
  equivalencia: string;
  estado: 'online' | 'offline' | 'cargando';
  tokensHoy: number;
  latencia: string;
}

// ─── Datos iniciales ──────────────────────────────────────────────────────────
const modelosIniciales: ModeloInfraestructura[] = [
  { id: 'm1', nombre: 'maris-velox-1b', equivalencia: 'Equiv. Haiku 4.5', estado: 'online', tokensHoy: 412000, latencia: '38ms' },
  { id: 'm2', nombre: 'maris-core-7b', equivalencia: 'Equiv. Sonnet 5', estado: 'offline', tokensHoy: 0, latencia: '--' },
  { id: 'm3', nombre: 'maris-pro-32b', equivalencia: 'Equiv. Opus 4.8', estado: 'offline', tokensHoy: 0, latencia: '--' },
];

const agentesIniciales: Agente[] = [
  { id: 'a1', nombre: 'Agente Coder', modelo: 'maris-velox-1b', estado: 'activo', sesiones: 47, ultimaActividad: 'hace 2 min' },
  { id: 'a2', nombre: 'Agente Analista', modelo: 'maris-velox-1b', estado: 'inactivo', sesiones: 12, ultimaActividad: 'hace 3 h' },
  { id: 'a3', nombre: 'Agente Soporte', modelo: 'maris-core-7b', estado: 'error', sesiones: 3, ultimaActividad: 'hace 1 dia' },
];

const sesionesIniciales: Sesion[] = [
  { id: 's1', agente: 'Agente Coder', inicio: '14/07/2026 01:38', tokens: 8420, estado: 'completada' },
  { id: 's2', agente: 'Agente Coder', inicio: '14/07/2026 01:22', tokens: 3100, estado: 'completada' },
  { id: 's3', agente: 'Agente Analista', inicio: '13/07/2026 22:10', tokens: 15600, estado: 'completada' },
  { id: 's4', agente: 'Agente Soporte', inicio: '13/07/2026 18:05', tokens: 2200, estado: 'error' },
];

// ─── Paleta de colores ────────────────────────────────────────────────────────
const C = {
  bg: '#0b0f19',
  sidebar: '#0d1117',
  card: '#161b27',
  cardBorder: '#1e2a3a',
  accent: '#22d3ee',
  accentDim: 'rgba(34,211,238,0.12)',
  green: '#34d399',
  red: '#f87171',
  yellow: '#fbbf24',
  gray: '#6b7280',
  grayLight: '#9ca3af',
  white: '#f1f5f9',
  text: '#cbd5e1',
};

// ─── Componentes auxiliares ───────────────────────────────────────────────────
const Badge: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44`, borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '600' }}>
    {children}
  </span>
);

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ backgroundColor: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: '16px', padding: '24px', ...style }}>
    {children}
  </div>
);

const Btn: React.FC<{ onClick?: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; children: React.ReactNode; style?: React.CSSProperties }> = ({ onClick, variant = 'secondary', children, style }) => {
  const variants: Record<string, React.CSSProperties> = {
    primary: { backgroundColor: C.accent, color: '#0b0f19', border: 'none' },
    secondary: { backgroundColor: '#1e2a3a', color: C.white, border: `1px solid ${C.cardBorder}` },
    danger: { backgroundColor: 'rgba(248,113,113,0.15)', color: C.red, border: '1px solid rgba(248,113,113,0.3)' },
    ghost: { backgroundColor: 'transparent', color: C.grayLight, border: `1px solid ${C.cardBorder}` },
  };
  return (
    <button onClick={onClick} style={{ ...variants[variant], padding: '9px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', ...style }}>
      {children}
    </button>
  );
};

// ─── Grafico de barras simple ─────────────────────────────────────────────────
const BarChart: React.FC<{ data: number[]; color: string; height?: number }> = ({ data, color, height = 60 }) => {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, backgroundColor: i === data.length - 1 ? color : `${color}55`, borderRadius: '3px 3px 0 0', height: `${(v / max) * 100}%`, minHeight: '4px' }} />
      ))}
    </div>
  );
};

// ─── Aplicacion principal ─────────────────────────────────────────────────────
export default function App() {
  const [seccion, setSeccion] = useState<string>('control');
  const [subSeccion, setSubSeccion] = useState<string>('workspace');
  const [saldo, setSaldo] = useState<number>(-1.73);
  const [vivaAmount, setVivaAmount] = useState<string>('50');
  const [bannerVisible, setBannerVisible] = useState<boolean>(true);
  const [keysApi, setKeysApi] = useState<ApiKey[]>([
    { id: 1, nombre: 'Master Admin Key', token: 'sk-marisai-master-19862210...', limite: 'ILIMITADO', estado: 'Activa', uso: 0, creada: '01/07/2026' }
  ]);
  const [modelos] = useState<ModeloInfraestructura[]>(modelosIniciales);
  const [agentes, setAgentes] = useState<Agente[]>(agentesIniciales);
  const [sesiones] = useState<Sesion[]>(sesionesIniciales);
  const [modalNuevaKey, setModalNuevaKey] = useState<boolean>(false);
  const [nuevoKeyNombre, setNuevoKeyNombre] = useState<string>('');
  const [nuevoKeyLimite, setNuevoKeyLimite] = useState<string>('50');
  const [modalNuevoAgente, setModalNuevoAgente] = useState<boolean>(false);
  const [nuevoAgenteNombre, setNuevoAgenteNombre] = useState<string>('');
  const [nuevoAgenteModelo, setNuevoAgenteModelo] = useState<string>('maris-velox-1b');
  const [horaActual, setHoraActual] = useState<string>('Buenas noches');

  useEffect(() => {
    const actualizar = () => {
      const h = new Date().getHours();
      setHoraActual(h < 12 ? 'Buenos dias' : h < 20 ? 'Buenas tardes' : 'Buenas noches');
    };
    actualizar();
    const t = setInterval(actualizar, 60000);
    return () => clearInterval(t);
  }, []);

  const tokenData = [1200000, 2100000, 1800000, 3400000, 2900000, 4100000, 6000000];

  const crearApiKey = () => {
    if (!nuevoKeyNombre.trim()) return;
    const rnd = Math.random().toString(36).substring(2, 14);
    setKeysApi([...keysApi, {
      id: Date.now(),
      nombre: nuevoKeyNombre,
      token: `sk-marisai-${rnd}...`,
      limite: nuevoKeyLimite ? `${nuevoKeyLimite} US$` : 'ILIMITADO',
      estado: 'Activa',
      uso: 0,
      creada: new Date().toLocaleDateString('es-ES')
    }]);
    setNuevoKeyNombre('');
    setNuevoKeyLimite('50');
    setModalNuevaKey(false);
  };

  const revocarKey = (id: number) => {
    setKeysApi(keysApi.map(k => k.id === id ? { ...k, estado: 'Suspendida' as const } : k));
  };

  const crearAgente = () => {
    if (!nuevoAgenteNombre.trim()) return;
    setAgentes([...agentes, {
      id: 'a' + Date.now(),
      nombre: nuevoAgenteNombre,
      modelo: nuevoAgenteModelo,
      estado: 'inactivo',
      sesiones: 0,
      ultimaActividad: 'nunca'
    }]);
    setNuevoAgenteNombre('');
    setModalNuevoAgente(false);
  };

  const procesarPago = () => {
    const monto = parseFloat(vivaAmount) || 0;
    setSaldo(prev => prev + monto);
    setSeccion('control');
  };

  // ─── Navegacion sidebar ──────────────────────────────────────────────────────
  const navItem = (id: string, icon: string, label: string, sub?: string, isSubItem?: boolean) => {
    const activo = seccion === id && (!sub || subSeccion === sub);
    return (
      <div
        onClick={() => { setSeccion(id); if (sub) setSubSeccion(sub); }}
        style={{
          padding: isSubItem ? '7px 12px 7px 28px' : '9px 12px',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: isSubItem ? '12px' : '13px',
          color: activo ? C.accent : C.grayLight,
          backgroundColor: activo ? C.accentDim : 'transparent',
          fontWeight: activo ? '600' : '400',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>{icon}</span>
        {label}
      </div>
    );
  };

  const sectionLabel = (text: string) => (
    <div style={{ fontSize: '10px', color: C.gray, textTransform: 'uppercase', letterSpacing: '1px', margin: '14px 0 4px 12px', fontWeight: '600' }}>{text}</div>
  );

  // ─── PANEL DE CONTROL ────────────────────────────────────────────────────────
  const renderControl = () => (
    <div style={{ padding: '40px', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '26px', fontWeight: '700', color: C.white }}>{horaActual}, Maria</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Btn onClick={() => setSeccion('claves')}>Obtener clave de API</Btn>
          <Btn variant="primary" onClick={() => setModalNuevoAgente(true)}>Crear un agente</Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <Card>
          <div style={{ fontSize: '12px', color: C.gray, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Creditos de la organizacion</div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: saldo < 0 ? C.red : C.green, marginBottom: '14px' }}>{saldo.toFixed(2)} US$</div>
          {saldo < 0 ? (
            <button onClick={() => setSeccion('recarga')} style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>
              Anadir fondos con Viva.com
            </button>
          ) : (
            <Badge color={C.green}>Saldo positivo</Badge>
          )}
        </Card>

        <Card>
          <div style={{ fontSize: '12px', color: C.gray, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Gasto este mes</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: C.white }}>43,73 US$</div>
            <Badge color={C.yellow}>4% utilizado</Badge>
          </div>
          <div style={{ fontSize: '11px', color: C.gray, borderTop: `1px solid ${C.cardBorder}`, paddingTop: '10px' }}>de 1000 US$ de limite — se restablece el 1 ago</div>
        </Card>

        <Card>
          <div style={{ fontSize: '12px', color: C.gray, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cache guardada</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: C.green }}>~1 US$</div>
            <Badge color={C.green}>6% aciertos</Badge>
          </div>
          <div style={{ fontSize: '11px', color: C.gray, borderTop: `1px solid ${C.cardBorder}`, paddingTop: '10px' }}>ahorro estimado ultimos 7 dias</div>
        </Card>
      </div>

      <Card>
        <div style={{ fontSize: '12px', color: C.gray, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Volumen de tokens transaccionados</div>
        <div style={{ fontSize: '36px', fontWeight: '700', color: C.white, marginTop: '4px', marginBottom: '16px' }}>
          6 M <span style={{ fontSize: '13px', color: C.gray, fontWeight: '400' }}>ultimos 7 dias</span>
        </div>
        <BarChart data={tokenData} color={C.accent} height={70} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
          {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => (
            <span key={d} style={{ fontSize: '10px', color: C.gray, flex: 1, textAlign: 'center' }}>{d}</span>
          ))}
        </div>
      </Card>

      <div>
        <div style={{ fontSize: '12px', color: C.gray, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600', marginBottom: '14px' }}>Tus modelos de infraestructura</div>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' as const }}>
          {modelos.map(m => (
            <div key={m.id} style={{
              backgroundColor: C.card,
              border: `1px solid ${m.estado === 'online' ? C.accent + '55' : C.cardBorder}`,
              borderLeft: `3px solid ${m.estado === 'online' ? C.accent : m.estado === 'cargando' ? C.yellow : C.gray}`,
              borderRadius: '12px',
              padding: '18px 20px',
              minWidth: '200px',
              cursor: 'pointer',
            }}>
              <div style={{ fontWeight: '700', color: C.white, fontSize: '14px', marginBottom: '4px' }}>{m.nombre}</div>
              <div style={{ fontSize: '11px', color: C.gray, marginBottom: '10px' }}>{m.equivalencia}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Badge color={m.estado === 'online' ? C.green : m.estado === 'cargando' ? C.yellow : C.gray}>
                  {m.estado === 'online' ? '● Online' : m.estado === 'cargando' ? '◌ Cargando' : '○ Offline'}
                </Badge>
                {m.estado === 'online' && <span style={{ fontSize: '11px', color: C.gray }}>{m.latencia}</span>}
              </div>
              {m.estado === 'online' && (
                <div style={{ fontSize: '11px', color: C.gray, marginTop: '8px' }}>{(m.tokensHoy / 1000).toFixed(0)}K tokens hoy</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <Card>
        <div style={{ fontSize: '12px', color: C.gray, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600', marginBottom: '16px' }}>Actividad reciente</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sesiones.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: '#0d1117', borderRadius: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>🤖</span>
                <div>
                  <div style={{ fontSize: '13px', color: C.white, fontWeight: '500' }}>{s.agente}</div>
                  <div style={{ fontSize: '11px', color: C.gray }}>{s.inicio}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '12px', color: C.gray }}>{s.tokens.toLocaleString()} tokens</span>
                <Badge color={s.estado === 'completada' ? C.green : s.estado === 'activa' ? C.accent : C.red}>{s.estado}</Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  // ─── CLAVES DE API ───────────────────────────────────────────────────────────
  const renderClaves = () => (
    <div style={{ padding: '40px', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.white }}>Claves de API</h1>
          <p style={{ fontSize: '13px', color: C.gray, marginTop: '4px' }}>Gestiona el acceso a tu infraestructura Maris AI para uso personal y clientes.</p>
        </div>
        <Btn variant="primary" onClick={() => setModalNuevaKey(true)}>+ Nueva clave</Btn>
      </div>

      <Card>
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                {['Nombre', 'Token', 'Limite', 'Uso', 'Estado', 'Creada', 'Acciones'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left' as const, color: C.gray, fontWeight: '600', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keysApi.map(k => (
                <tr key={k.id} style={{ borderBottom: `1px solid ${C.cardBorder}22` }}>
                  <td style={{ padding: '14px', color: C.white, fontWeight: '500' }}>{k.nombre}</td>
                  <td style={{ padding: '14px' }}>
                    <code style={{ backgroundColor: '#0d1117', color: C.accent, padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace' }}>{k.token}</code>
                  </td>
                  <td style={{ padding: '14px', color: C.text }}>{k.limite}</td>
                  <td style={{ padding: '14px', color: C.text }}>{k.uso.toLocaleString()} tokens</td>
                  <td style={{ padding: '14px' }}><Badge color={k.estado === 'Activa' ? C.green : C.red}>{k.estado}</Badge></td>
                  <td style={{ padding: '14px', color: C.gray }}>{k.creada}</td>
                  <td style={{ padding: '14px' }}>
                    {k.estado === 'Activa' && (
                      <Btn variant="danger" onClick={() => revocarKey(k.id)} style={{ padding: '5px 10px', fontSize: '11px' }}>Revocar</Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: '12px', color: C.gray, textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600', marginBottom: '14px' }}>Como usar tu clave de API</div>
        <pre style={{ backgroundColor: '#0d1117', borderRadius: '10px', padding: '16px', fontSize: '12px', color: C.accent, overflowX: 'auto' as const, lineHeight: '1.6', margin: 0 }}>{`# Llamada a tu gateway Maris AI
curl https://api.marisai.local/v1/chat/completions \\
  -H "Authorization: Bearer sk-marisai-TU_CLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "maris-velox-1b",
    "messages": [{"role": "user", "content": "Hola"}]
  }'`}</pre>
      </Card>
    </div>
  );

  // ─── COMPILAR ────────────────────────────────────────────────────────────────
  const renderCompilar = () => (
    <div style={{ padding: '40px', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.white }}>Compilar</h1>

      <div style={{ display: 'flex', gap: '4px', backgroundColor: '#0d1117', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
        {[['workspace', 'Area de trabajo'], ['archivos', 'Archivos'], ['habilidades', 'Habilidades']].map(([id, label]) => (
          <button key={id} onClick={() => setSubSeccion(id)} style={{
            padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', border: 'none',
            backgroundColor: subSeccion === id ? C.card : 'transparent',
            color: subSeccion === id ? C.white : C.gray,
          }}>{label}</button>
        ))}
      </div>

      {subSeccion === 'workspace' && (
        <Card>
          <div style={{ fontSize: '12px', color: C.gray, marginBottom: '16px', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600' }}>Area de trabajo — Nuevo</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {[
              { icon: '🧪', titulo: 'Playground de modelos', desc: 'Prueba tus modelos con prompts personalizados en tiempo real.' },
              { icon: '⚡', titulo: 'Evaluacion de rendimiento', desc: 'Benchmarks de latencia, throughput y calidad de respuesta.' },
              { icon: '🔧', titulo: 'Fine-tuning (proximamente)', desc: 'Ajusta tus modelos con datos propios para casos de uso especificos.' },
              { icon: '📦', titulo: 'Despliegue de modelos', desc: 'Gestiona que modelos estan activos en tu infraestructura Docker.' },
            ].map(item => (
              <div key={item.titulo} style={{ backgroundColor: '#0d1117', borderRadius: '12px', padding: '18px', border: `1px solid ${C.cardBorder}`, cursor: 'pointer' }}>
                <div style={{ fontSize: '20px', marginBottom: '8px' }}>{item.icon}</div>
                <div style={{ fontWeight: '600', color: C.white, fontSize: '14px', marginBottom: '6px' }}>{item.titulo}</div>
                <div style={{ fontSize: '12px', color: C.gray, lineHeight: '1.5' }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {subSeccion === 'archivos' && (
        <Card>
          <div style={{ fontSize: '12px', color: C.gray, marginBottom: '16px', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600' }}>Archivos del sistema</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              { nombre: 'gateway/server.js', tipo: 'JavaScript', tamanio: '4.6 KB', modificado: '13/07/2026' },
              { nombre: 'agent/agent.js', tipo: 'JavaScript', tamanio: '5.5 KB', modificado: '13/07/2026' },
              { nombre: 'nginx/nginx.conf', tipo: 'Config', tamanio: '1.6 KB', modificado: '13/07/2026' },
              { nombre: 'docker-compose.yml', tipo: 'YAML', tamanio: '1.2 KB', modificado: '13/07/2026' },
              { nombre: '.env.example', tipo: 'ENV', tamanio: '0.9 KB', modificado: '13/07/2026' },
            ].map(f => (
              <div key={f.nombre} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: '#0d1117', borderRadius: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>📄</span>
                  <code style={{ color: C.accent, fontSize: '12px' }}>{f.nombre}</code>
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: C.gray }}>
                  <span>{f.tipo}</span><span>{f.tamanio}</span><span>{f.modificado}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {subSeccion === 'habilidades' && (
        <Card>
          <div style={{ fontSize: '12px', color: C.gray, marginBottom: '16px', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600' }}>Habilidades del sistema</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { nombre: 'Ejecucion de codigo en sandbox Docker', activa: true, desc: 'Los agentes pueden ejecutar codigo Python aislado con limites de CPU/RAM.' },
              { nombre: 'Auto-correccion de errores', activa: true, desc: 'Si el codigo falla, el agente lo reintenta con el error como contexto.' },
              { nombre: 'Medicion de tokens por cliente', activa: true, desc: 'Cada API key registra su consumo en SQLite para facturacion.' },
              { nombre: 'Rate limiting por IP', activa: true, desc: 'Nginx limita a 10 req/seg con rafaga de 20 para proteger la infraestructura.' },
              { nombre: 'Soporte multi-modelo', activa: false, desc: 'Enrutar peticiones a diferentes modelos segun la clave API (proximamente).' },
            ].map(h => (
              <div key={h.nombre} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px', backgroundColor: '#0d1117', borderRadius: '10px' }}>
                <div style={{ flex: 1, marginRight: '12px' }}>
                  <div style={{ fontWeight: '600', color: C.white, fontSize: '13px', marginBottom: '4px' }}>{h.nombre}</div>
                  <div style={{ fontSize: '12px', color: C.gray }}>{h.desc}</div>
                </div>
                <Badge color={h.activa ? C.green : C.gray}>{h.activa ? 'Activa' : 'Pendiente'}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );

  // ─── INICIO RAPIDO ───────────────────────────────────────────────────────────
  const renderInicioRapido = () => (
    <div style={{ padding: '40px', maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.white }}>Inicio rapido</h1>
      <p style={{ fontSize: '14px', color: C.gray, lineHeight: '1.6' }}>Sigue estos pasos para poner en marcha tu infraestructura de agentes Maris AI.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[
          { paso: '1', titulo: 'Configura tu entorno Docker', desc: 'Asegurate de tener Docker Desktop corriendo con los contenedores marisai-proxy, ollama y ggml activos.', estado: 'completado' },
          { paso: '2', titulo: 'Crea tu primera API key', desc: 'Ve a "Claves de API" y genera una clave maestra para uso personal o para asignar a un cliente.', estado: 'completado' },
          { paso: '3', titulo: 'Despliega un modelo de infraestructura', desc: 'Activa maris-velox-1b desde el panel de control para empezar a procesar peticiones.', estado: 'completado' },
          { paso: '4', titulo: 'Crea tu primer agente', desc: 'Configura un agente con un modelo y un prompt de sistema para automatizar tareas.', estado: 'pendiente' },
          { paso: '5', titulo: 'Configura facturacion para clientes', desc: 'Asigna limites de tokens por clave y conecta Viva.com para cobrar a tus clientes.', estado: 'pendiente' },
        ].map(item => (
          <div key={item.paso} style={{ display: 'flex', gap: '16px', padding: '20px', backgroundColor: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: '14px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: item.estado === 'completado' ? C.green : C.accentDim, border: `2px solid ${item.estado === 'completado' ? C.green : C.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '13px', fontWeight: '700', color: item.estado === 'completado' ? '#0b0f19' : C.accent }}>{item.estado === 'completado' ? '✓' : item.paso}</span>
            </div>
            <div>
              <div style={{ fontWeight: '600', color: C.white, fontSize: '14px', marginBottom: '4px' }}>{item.titulo}</div>
              <div style={{ fontSize: '12px', color: C.gray, lineHeight: '1.5' }}>{item.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ─── AGENTES ─────────────────────────────────────────────────────────────────
  const renderAgentes = () => (
    <div style={{ padding: '40px', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.white }}>Agentes</h1>
          <p style={{ fontSize: '13px', color: C.gray, marginTop: '4px' }}>Gestiona tus agentes de IA conectados a la infraestructura Maris AI.</p>
        </div>
        <Btn variant="primary" onClick={() => setModalNuevoAgente(true)}>+ Nuevo agente</Btn>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {agentes.map(a => (
          <Card key={a.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div style={{ width: '40px', height: '40px', backgroundColor: C.accentDim, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>🤖</div>
              <Badge color={a.estado === 'activo' ? C.green : a.estado === 'error' ? C.red : C.gray}>
                {a.estado === 'activo' ? '● Activo' : a.estado === 'error' ? '✕ Error' : '○ Inactivo'}
              </Badge>
            </div>
            <div style={{ fontWeight: '700', color: C.white, fontSize: '15px', marginBottom: '4px' }}>{a.nombre}</div>
            <div style={{ fontSize: '12px', color: C.gray, marginBottom: '14px' }}>Modelo: <span style={{ color: C.accent }}>{a.modelo}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: C.gray, borderTop: `1px solid ${C.cardBorder}`, paddingTop: '12px' }}>
              <span>{a.sesiones} sesiones</span>
              <span>{a.ultimaActividad}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );

  // ─── SESIONES ────────────────────────────────────────────────────────────────
  const renderSesiones = () => (
    <div style={{ padding: '40px', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.white }}>Sesiones</h1>
      <Card>
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                {['ID', 'Agente', 'Inicio', 'Tokens', 'Estado'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left' as const, color: C.gray, fontWeight: '600', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sesiones.map(s => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${C.cardBorder}22` }}>
                  <td style={{ padding: '14px' }}><code style={{ color: C.gray, fontSize: '11px' }}>{s.id}</code></td>
                  <td style={{ padding: '14px', color: C.white }}>{s.agente}</td>
                  <td style={{ padding: '14px', color: C.gray }}>{s.inicio}</td>
                  <td style={{ padding: '14px', color: C.text }}>{s.tokens.toLocaleString()}</td>
                  <td style={{ padding: '14px' }}><Badge color={s.estado === 'completada' ? C.green : s.estado === 'activa' ? C.accent : C.red}>{s.estado}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  // ─── ANALITICAS ──────────────────────────────────────────────────────────────
  const renderAnaliticas = () => (
    <div style={{ padding: '40px', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.white }}>Uso general</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {[
          { label: 'Total tokens (mes)', valor: '6.2M', color: C.accent },
          { label: 'Peticiones totales', valor: '1,847', color: C.green },
          { label: 'Clientes activos', valor: '1', color: C.yellow },
          { label: 'Tiempo medio resp.', valor: '38ms', color: C.green },
        ].map(m => (
          <Card key={m.label} style={{ textAlign: 'center' as const }}>
            <div style={{ fontSize: '11px', color: C.gray, textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>{m.label}</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: m.color }}>{m.valor}</div>
          </Card>
        ))}
      </div>
      <Card>
        <div style={{ fontSize: '12px', color: C.gray, textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600', marginBottom: '16px' }}>Tokens por dia (ultimos 7 dias)</div>
        <BarChart data={tokenData} color={C.accent} height={100} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
          {['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map(d => (
            <span key={d} style={{ fontSize: '11px', color: C.gray, flex: 1, textAlign: 'center' as const }}>{d}</span>
          ))}
        </div>
      </Card>
      <Card>
        <div style={{ fontSize: '12px', color: C.gray, textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600', marginBottom: '16px' }}>Uso por modelo</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            { modelo: 'maris-velox-1b', tokens: 6000000, total: 6200000 },
            { modelo: 'maris-core-7b', tokens: 200000, total: 6200000 },
          ].map(m => (
            <div key={m.modelo}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', color: C.white }}>{m.modelo}</span>
                <span style={{ fontSize: '12px', color: C.gray }}>{(m.tokens / 1000000).toFixed(1)}M tokens</span>
              </div>
              <div style={{ height: '6px', backgroundColor: '#1e2a3a', borderRadius: '3px' }}>
                <div style={{ height: '100%', width: `${(m.tokens / m.total) * 100}%`, backgroundColor: C.accent, borderRadius: '3px' }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  // ─── RECARGA ─────────────────────────────────────────────────────────────────
  const renderRecarga = () => (
    <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.white }}>Anadir fondos</h1>
      <Card>
        <div style={{ fontSize: '13px', color: C.gray, marginBottom: '20px' }}>Recarga el saldo de tu organizacion Maris AI mediante Viva.com.</div>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', color: C.gray, display: 'block', marginBottom: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Importe (US$)</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            {['10', '25', '50', '100'].map(v => (
              <button key={v} onClick={() => setVivaAmount(v)} style={{
                flex: 1, padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
                backgroundColor: vivaAmount === v ? C.accent : '#0d1117',
                color: vivaAmount === v ? '#0b0f19' : C.grayLight,
                border: `1px solid ${vivaAmount === v ? C.accent : C.cardBorder}`,
              }}>{v} US$</button>
            ))}
          </div>
          <input type="number" value={vivaAmount} onChange={e => setVivaAmount(e.target.value)}
            style={{ width: '100%', backgroundColor: '#0d1117', border: `1px solid ${C.cardBorder}`, borderRadius: '10px', padding: '12px 14px', color: C.white, fontSize: '14px', boxSizing: 'border-box' as const }}
            placeholder="Importe personalizado" />
        </div>
        <div style={{ backgroundColor: '#0d1117', borderRadius: '10px', padding: '14px', marginBottom: '20px', fontSize: '12px', color: C.gray, lineHeight: '1.6' }}>
          <div style={{ color: C.white, fontWeight: '600', marginBottom: '6px' }}>Resumen del pago</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Saldo actual</span><span style={{ color: C.red }}>{saldo.toFixed(2)} US$</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Recarga</span><span style={{ color: C.green }}>+{parseFloat(vivaAmount || '0').toFixed(2)} US$</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.cardBorder}`, paddingTop: '8px', marginTop: '8px', fontWeight: '600', color: C.white }}>
            <span>Saldo resultante</span>
            <span style={{ color: (saldo + parseFloat(vivaAmount || '0')) >= 0 ? C.green : C.red }}>{(saldo + parseFloat(vivaAmount || '0')).toFixed(2)} US$</span>
          </div>
        </div>
        <button onClick={procesarPago} style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '14px', borderRadius: '12px', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>
          Pagar con Viva.com
        </button>
      </Card>
    </div>
  );

  // ─── MODALES ─────────────────────────────────────────────────────────────────
  const renderModalKey = () => (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: '16px', padding: '32px', width: '420px', maxWidth: '90vw' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: C.white, marginBottom: '20px' }}>Nueva clave de API</h2>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '12px', color: C.gray, display: 'block', marginBottom: '6px' }}>Nombre del cliente / uso</label>
          <input type="text" value={nuevoKeyNombre} onChange={e => setNuevoKeyNombre(e.target.value)} placeholder="Ej: Cliente Empresa S.L."
            style={{ width: '100%', backgroundColor: '#0d1117', border: `1px solid ${C.cardBorder}`, borderRadius: '8px', padding: '10px 12px', color: C.white, fontSize: '13px', boxSizing: 'border-box' as const }} />
        </div>
        <div style={{ marginBottom: '24px' }}>
          <label style={{ fontSize: '12px', color: C.gray, display: 'block', marginBottom: '6px' }}>Limite mensual (US$) — dejar vacio para ilimitado</label>
          <input type="number" value={nuevoKeyLimite} onChange={e => setNuevoKeyLimite(e.target.value)} placeholder="50"
            style={{ width: '100%', backgroundColor: '#0d1117', border: `1px solid ${C.cardBorder}`, borderRadius: '8px', padding: '10px 12px', color: C.white, fontSize: '13px', boxSizing: 'border-box' as const }} />
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Btn onClick={() => setModalNuevaKey(false)} style={{ flex: 1 }}>Cancelar</Btn>
          <Btn variant="primary" onClick={crearApiKey} style={{ flex: 1 }}>Crear clave</Btn>
        </div>
      </div>
    </div>
  );

  const renderModalAgente = () => (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: '16px', padding: '32px', width: '420px', maxWidth: '90vw' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: C.white, marginBottom: '20px' }}>Crear nuevo agente</h2>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '12px', color: C.gray, display: 'block', marginBottom: '6px' }}>Nombre del agente</label>
          <input type="text" value={nuevoAgenteNombre} onChange={e => setNuevoAgenteNombre(e.target.value)} placeholder="Ej: Agente de ventas"
            style={{ width: '100%', backgroundColor: '#0d1117', border: `1px solid ${C.cardBorder}`, borderRadius: '8px', padding: '10px 12px', color: C.white, fontSize: '13px', boxSizing: 'border-box' as const }} />
        </div>
        <div style={{ marginBottom: '24px' }}>
          <label style={{ fontSize: '12px', color: C.gray, display: 'block', marginBottom: '6px' }}>Modelo de infraestructura</label>
          <select value={nuevoAgenteModelo} onChange={e => setNuevoAgenteModelo(e.target.value)}
            style={{ width: '100%', backgroundColor: '#0d1117', border: `1px solid ${C.cardBorder}`, borderRadius: '8px', padding: '10px 12px', color: C.white, fontSize: '13px', boxSizing: 'border-box' as const }}>
            {modelos.map(m => <option key={m.id} value={m.nombre}>{m.nombre} — {m.equivalencia}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Btn onClick={() => setModalNuevoAgente(false)} style={{ flex: 1 }}>Cancelar</Btn>
          <Btn variant="primary" onClick={crearAgente} style={{ flex: 1 }}>Crear agente</Btn>
        </div>
      </div>
    </div>
  );

  // ─── RENDER PRINCIPAL ────────────────────────────────────────────────────────
  const renderContenido = () => {
    switch (seccion) {
      case 'control': return renderControl();
      case 'claves': return renderClaves();
      case 'compilar': return renderCompilar();
      case 'inicio-rapido': return renderInicioRapido();
      case 'agentes': return renderAgentes();
      case 'sesiones': return renderSesiones();
      case 'analiticas': return renderAnaliticas();
      case 'recarga': return renderRecarga();
      default: return renderControl();
    }
  };

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', backgroundColor: C.bg, color: C.text, display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>

      {/* ── SIDEBAR ── */}
      <aside style={{ width: '230px', backgroundColor: C.sidebar, borderRight: `1px solid ${C.cardBorder}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100vh', flexShrink: 0 }}>
        <div style={{ overflowY: 'auto' as const, padding: '14px 10px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: C.accentDim, borderRadius: '10px', border: `1px solid ${C.accent}33`, marginBottom: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '24px', height: '24px', backgroundColor: C.accent, borderRadius: '6px', color: '#0b0f19', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>M</div>
              <span style={{ fontWeight: '700', color: C.white, fontSize: '14px' }}>Maris AI</span>
            </div>
            <span style={{ color: C.gray, fontSize: '10px' }}>▼</span>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {navItem('control', '🏠', 'Panel de control')}
            {navItem('claves', '🔑', 'Claves de API')}
            {sectionLabel('Compilar')}
            {navItem('compilar', '🛠', 'Area de trabajo', 'workspace', true)}
            {navItem('compilar', '📁', 'Archivos', 'archivos', true)}
            {navItem('compilar', '✨', 'Habilidades', 'habilidades', true)}
            {sectionLabel('Agentes gestionados')}
            {navItem('inicio-rapido', '⚡', 'Inicio rapido', undefined, true)}
            {navItem('agentes', '🤖', 'Agentes', undefined, true)}
            {navItem('sesiones', '💬', 'Sesiones', undefined, true)}
            {sectionLabel('Analiticas')}
            {navItem('analiticas', '📊', 'Uso general', undefined, true)}
          </nav>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px' }}>
          {saldo < 0 && (
            <div onClick={() => setSeccion('recarga')} style={{ backgroundColor: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', padding: '10px 12px', borderRadius: '10px', fontSize: '11px', color: C.red, lineHeight: '1.5', cursor: 'pointer', marginBottom: '10px' }}>
              Saldo pendiente: <strong>{saldo.toFixed(2)} US$</strong>. <span style={{ textDecoration: 'underline', color: C.white }}>Anadir fondos</span> para reanudar el acceso.
            </div>
          )}
          <div style={{ backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${C.cardBorder}`, padding: '10px 12px', borderRadius: '10px', fontSize: '12px' }}>
            <div style={{ fontWeight: '600', color: C.white }}>Maria</div>
            <div style={{ color: C.gray, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>rrhh.milchollos@gmail.com</div>
          </div>
        </div>
      </aside>

      {/* ── CONTENIDO PRINCIPAL ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {bannerVisible && (
          <div style={{ backgroundColor: 'rgba(34,211,238,0.08)', borderBottom: `1px solid ${C.accent}33`, padding: '10px 24px', fontSize: '13px', color: C.accent, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <span>El acceso a tus 11 agentes de software locales ha sido restaurado con exito.</span>
            <button onClick={() => setBannerVisible(false)} style={{ background: 'none', border: 'none', color: C.gray, cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}>✕</button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' as const }}>
          {renderContenido()}
        </div>
      </main>

      {/* ── MODALES ── */}
      {modalNuevaKey && renderModalKey()}
      {modalNuevoAgente && renderModalAgente()}
    </div>
  );
}
