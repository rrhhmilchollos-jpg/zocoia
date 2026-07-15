import React, { useState, useEffect } from 'react';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface Usuario {
  id: string;
  email: string;
  nombre: string;
  rol: 'cliente' | 'admin';
  saldo: number;
  tokensComprados: number;
  tokensUsados: number;
  fechaCreacion: string;
}

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

interface PaqueteTokens {
  id: string;
  nombre: string;
  tokens: number;
  precio: number;
  descuento: number;
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

const paquetesTokens: PaqueteTokens[] = [
  { id: 'p1', nombre: 'Starter', tokens: 100000, precio: 10, descuento: 0 },
  { id: 'p2', nombre: 'Professional', tokens: 500000, precio: 45, descuento: 10 },
  { id: 'p3', nombre: 'Enterprise', tokens: 2000000, precio: 160, descuento: 20 },
  { id: 'p4', nombre: 'Unlimited', tokens: 10000000, precio: 700, descuento: 30 },
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
  // Estado de autenticación
  const [usuarioActual, setUsuarioActual] = useState<Usuario | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  
  // Usuario admin predefinido
  const usuarioAdminPredefinido: Usuario = {
    id: 'admin-001',
    email: 'rrhh.milchollos@gmail.com',
    nombre: 'Administrador',
    rol: 'admin',
    saldo: 0,
    tokensComprados: 0,
    tokensUsados: 0,
    fechaCreacion: '01/07/2026',
  };

  // Usuario cliente de prueba
  const usuarioClientePrueba: Usuario = {
    id: 'client-001',
    email: 'cliente@example.com',
    nombre: 'Maria',
    rol: 'cliente',
    saldo: -1.73,
    tokensComprados: 1000000,
    tokensUsados: 850000,
    fechaCreacion: '05/07/2026',
  };

  // Estado del dashboard
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
  const [modalCompraTokens, setModalCompraTokens] = useState<boolean>(false);
  const [paqueteSeleccionado, setPaqueteSeleccionado] = useState<string>('p2');

  // Usuarios para admin (simulado)
  const [usuarios, setUsuarios] = useState<Usuario[]>([usuarioClientePrueba]);

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

  // Funciones de autenticación
  const handleLogin = () => {
    setLoginError('');
    
    if (loginEmail === 'rrhh.milchollos@gmail.com' && loginPassword === '19862210Des') {
      setUsuarioActual(usuarioAdminPredefinido);
      setLoginEmail('');
      setLoginPassword('');
    } else if (loginEmail === 'cliente@example.com' && loginPassword === 'cliente123') {
      setUsuarioActual(usuarioClientePrueba);
      setLoginEmail('');
      setLoginPassword('');
    } else {
      setLoginError('Email o contraseña incorrectos');
    }
  };

  const handleLogout = () => {
    setUsuarioActual(null);
    setSeccion('control');
    setLoginEmail('');
    setLoginPassword('');
  };

  // Funciones de cliente
  const crearApiKey = () => {
    if (!nuevoKeyNombre.trim()) return;
    const rnd = Math.random().toString(36).substring(2, 14);
    setKeysApi([...keysApi, {
      id: Date.now(),
      nombre: nuevoKeyNombre,
      token: `sk-marisai-${rnd}...`,
      limite: nuevoKeyLimite ? `${nuevoKeyLimite} €` : 'ILIMITADO',
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

  const comprarTokens = (paqueteId: string) => {
    const paquete = paquetesTokens.find(p => p.id === paqueteId);
    if (paquete && usuarioActual) {
      const nuevoUsuario = {
        ...usuarioActual,
        tokensComprados: usuarioActual.tokensComprados + paquete.tokens,
        saldo: usuarioActual.saldo - paquete.precio,
      };
      setUsuarioActual(nuevoUsuario);
      setModalCompraTokens(false);
    }
  };

  // ─── PANTALLA DE LOGIN ────────────────────────────────────────────────────────
  if (!usuarioActual) {
    return (
      <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', backgroundColor: C.bg, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100vw' }}>
        <div style={{ width: '100%', maxWidth: '400px', padding: '40px' }}>
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <div style={{ fontSize: '32px', fontWeight: '700', color: C.accent, marginBottom: '8px' }}>🚀 Zoco IA</div>
            <div style={{ fontSize: '14px', color: C.gray }}>Panel de Control de Infraestructura</div>
          </div>

          <Card style={{ padding: '32px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: '700', color: C.white, marginBottom: '24px', textAlign: 'center' }}>Iniciar sesión</h1>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: C.gray, display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleLogin()}
                placeholder="tu@email.com"
                style={{ width: '100%', backgroundColor: '#0d1117', border: `1px solid ${C.cardBorder}`, borderRadius: '8px', padding: '10px 12px', color: C.white, fontSize: '13px', boxSizing: 'border-box' as const }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ fontSize: '12px', color: C.gray, display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Contraseña</label>
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
                style={{ width: '100%', backgroundColor: '#0d1117', border: `1px solid ${C.cardBorder}`, borderRadius: '8px', padding: '10px 12px', color: C.white, fontSize: '13px', boxSizing: 'border-box' as const }}
              />
            </div>

            {loginError && (
              <div style={{ backgroundColor: 'rgba(248,113,113,0.15)', border: `1px solid ${C.red}44`, borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '12px', color: C.red }}>
                {loginError}
              </div>
            )}

            <button
              onClick={handleLogin}
              style={{ width: '100%', backgroundColor: C.accent, color: '#0b0f19', border: 'none', padding: '12px', borderRadius: '10px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', marginBottom: '16px' }}
            >
              Iniciar sesión
            </button>

            <div style={{ fontSize: '11px', color: C.gray, textAlign: 'center', lineHeight: '1.6' }}>
              <div style={{ marginBottom: '8px' }}>Credenciales de prueba:</div>
              <div style={{ color: C.grayLight }}>Admin: rrhh.milchollos@gmail.com / 19862210Des</div>
              <div style={{ color: C.grayLight }}>Cliente: cliente@example.com / cliente123</div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // ─── NAVEGACION sidebar ──────────────────────────────────────────────────────
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

  // ─── PANEL DE CONTROL CLIENTE ────────────────────────────────────────────────
  const renderControlCliente = () => (
    <div style={{ padding: '40px', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '26px', fontWeight: '700', color: C.white }}>{horaActual}, {usuarioActual?.nombre}</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Btn onClick={() => setSeccion('claves')}>Obtener clave de API</Btn>
          <Btn variant="primary" onClick={() => setModalNuevoAgente(true)}>Crear un agente</Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <Card>
          <div style={{ fontSize: '12px', color: C.gray, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Saldo de la cuenta</div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: saldo < 0 ? C.red : C.green, marginBottom: '14px' }}>{saldo.toFixed(2)} €</div>
          {saldo < 0 ? (
            <button onClick={() => setSeccion('recarga')} style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>
              Añadir fondos con Viva.com
            </button>
          ) : (
            <Badge color={C.green}>Saldo positivo</Badge>
          )}
        </Card>

        <Card>
          <div style={{ fontSize: '12px', color: C.gray, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tokens disponibles</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: C.white }}>150K</div>
            <Badge color={C.yellow}>15% utilizado</Badge>
          </div>
          <div style={{ fontSize: '11px', color: C.gray, borderTop: `1px solid ${C.cardBorder}`, paddingTop: '10px' }}>de 1M tokens — se renuevan el 1 ago</div>
        </Card>

        <Card>
          <div style={{ fontSize: '12px', color: C.gray, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cache guardada</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: C.green }}>~1 €</div>
            <Badge color={C.green}>6% aciertos</Badge>
          </div>
          <div style={{ fontSize: '11px', color: C.gray, borderTop: `1px solid ${C.cardBorder}`, paddingTop: '10px' }}>ahorro estimado últimos 7 días</div>
        </Card>
      </div>

      <Card>
        <div style={{ fontSize: '12px', color: C.gray, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Volumen de tokens transaccionados</div>
        <div style={{ fontSize: '36px', fontWeight: '700', color: C.white, marginTop: '4px', marginBottom: '16px' }}>
          6 M <span style={{ fontSize: '13px', color: C.gray, fontWeight: '400' }}>últimos 7 días</span>
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
    </div>
  );

  // ─── PANEL DE COMPRA DE TOKENS ────────────────────────────────────────────────
  const renderCompraTokens = () => (
    <div style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '26px', fontWeight: '700', color: C.white, marginBottom: '8px' }}>Comprar Tokens</h1>
        <p style={{ fontSize: '14px', color: C.gray }}>Selecciona el paquete que mejor se adapte a tus necesidades</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
        {paquetesTokens.map(paquete => (
          <Card key={paquete.id} style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            {paquete.descuento > 0 && (
              <div style={{ position: 'absolute', top: '-12px', right: '20px', backgroundColor: C.green, color: '#0b0f19', padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>
                -{paquete.descuento}%
              </div>
            )}
            <div>
              <div style={{ fontSize: '18px', fontWeight: '700', color: C.white, marginBottom: '8px' }}>{paquete.nombre}</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: C.accent, marginBottom: '4px' }}>
                {(paquete.tokens / 1000000).toFixed(1)}M
              </div>
              <div style={{ fontSize: '12px', color: C.gray, marginBottom: '16px' }}>tokens</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: C.white, marginBottom: '4px' }}>
                {paquete.precio} €
              </div>
              <div style={{ fontSize: '11px', color: C.gray, marginBottom: '16px' }}>
                {(paquete.precio / (paquete.tokens / 1000000)).toFixed(2)} € por millón
              </div>
            </div>
            <Btn variant="primary" onClick={() => comprarTokens(paquete.id)} style={{ width: '100%' }}>
              Comprar ahora
            </Btn>
          </Card>
        ))}
      </div>

      <Card>
        <div style={{ fontSize: '14px', color: C.gray, lineHeight: '1.8' }}>
          <div style={{ color: C.white, fontWeight: '700', marginBottom: '12px' }}>¿Necesitas más tokens?</div>
          <p>Contáctanos para planes personalizados y soporte dedicado. Ofrecemos descuentos especiales para empresas y uso en producción.</p>
        </div>
      </Card>
    </div>
  );

  // ─── PANEL DE CLAVES API ──────────────────────────────────────────────────────
  const renderClaves = () => (
    <div style={{ padding: '40px', maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.white }}>Claves de API</h1>
          <p style={{ fontSize: '13px', color: C.gray, marginTop: '4px' }}>Gestiona tus claves de acceso a la API de Maris AI</p>
        </div>
        <Btn variant="primary" onClick={() => setModalNuevaKey(true)}>+ Nueva clave</Btn>
      </div>

      <Card>
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                {['Nombre', 'Token', 'Límite', 'Uso', 'Estado', 'Creada', 'Acciones'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left' as const, color: C.gray, fontWeight: '600', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keysApi.map(k => (
                <tr key={k.id} style={{ borderBottom: `1px solid ${C.cardBorder}22` }}>
                  <td style={{ padding: '14px', color: C.white, fontWeight: '600' }}>{k.nombre}</td>
                  <td style={{ padding: '14px' }}><code style={{ color: C.gray, fontSize: '11px', backgroundColor: '#0d1117', padding: '4px 8px', borderRadius: '4px' }}>{k.token}</code></td>
                  <td style={{ padding: '14px', color: C.text }}>{k.limite}</td>
                  <td style={{ padding: '14px', color: C.gray }}>{k.uso}%</td>
                  <td style={{ padding: '14px' }}><Badge color={k.estado === 'Activa' ? C.green : C.red}>{k.estado}</Badge></td>
                  <td style={{ padding: '14px', color: C.gray }}>{k.creada}</td>
                  <td style={{ padding: '14px' }}>
                    {k.estado === 'Activa' && (
                      <button onClick={() => revocarKey(k.id)} style={{ backgroundColor: 'transparent', color: C.red, border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                        Revocar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  // ─── PANEL DE AGENTES ──────────────────────────────────────────────────────────
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

  // ─── PANEL DE SESIONES ────────────────────────────────────────────────────────
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

  // ─── PANEL DE ANALÍTICAS ──────────────────────────────────────────────────────
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
        <div style={{ fontSize: '12px', color: C.gray, textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600', marginBottom: '16px' }}>Tokens por día (últimos 7 días)</div>
        <BarChart data={tokenData} color={C.accent} height={100} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sab', 'Dom'].map(d => (
            <span key={d} style={{ fontSize: '11px', color: C.gray, flex: 1, textAlign: 'center' as const }}>{d}</span>
          ))}
        </div>
      </Card>
    </div>
  );

  // ─── PANEL DE RECARGA ──────────────────────────────────────────────────────────
  const renderRecarga = () => (
    <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: C.white }}>Añadir fondos</h1>
      <Card>
        <div style={{ fontSize: '13px', color: C.gray, marginBottom: '20px' }}>Recarga el saldo de tu cuenta Maris AI mediante Viva.com.</div>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', color: C.gray, display: 'block', marginBottom: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Importe (€)</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            {['10', '25', '50', '100'].map(v => (
              <button key={v} onClick={() => setVivaAmount(v)} style={{
                flex: 1, padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600',
                backgroundColor: vivaAmount === v ? C.accent : '#0d1117',
                color: vivaAmount === v ? '#0b0f19' : C.grayLight,
                border: `1px solid ${vivaAmount === v ? C.accent : C.cardBorder}`,
              }}>{v} €</button>
            ))}
          </div>
          <input type="number" value={vivaAmount} onChange={e => setVivaAmount(e.target.value)}
            style={{ width: '100%', backgroundColor: '#0d1117', border: `1px solid ${C.cardBorder}`, borderRadius: '10px', padding: '12px 14px', color: C.white, fontSize: '14px', boxSizing: 'border-box' as const }}
            placeholder="Importe personalizado" />
        </div>
        <div style={{ backgroundColor: '#0d1117', borderRadius: '10px', padding: '14px', marginBottom: '20px', fontSize: '12px', color: C.gray, lineHeight: '1.6' }}>
          <div style={{ color: C.white, fontWeight: '600', marginBottom: '6px' }}>Resumen del pago</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Saldo actual</span><span style={{ color: C.red }}>{saldo.toFixed(2)} €</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Recarga</span><span style={{ color: C.green }}>+{parseFloat(vivaAmount || '0').toFixed(2)} €</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.cardBorder}`, paddingTop: '8px', marginTop: '8px', fontWeight: '600', color: C.white }}>
            <span>Saldo resultante</span>
            <span style={{ color: (saldo + parseFloat(vivaAmount || '0')) >= 0 ? C.green : C.red }}>{(saldo + parseFloat(vivaAmount || '0')).toFixed(2)} €</span>
          </div>
        </div>
        <button onClick={procesarPago} style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '14px', borderRadius: '12px', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>
          Pagar con Viva.com
        </button>
      </Card>
    </div>
  );

  // ─── PANEL DE ADMINISTRACIÓN ───────────────────────────────────────────────────
  const renderAdminDashboard = () => (
    <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <h1 style={{ fontSize: '26px', fontWeight: '700', color: C.white }}>Panel de Administración</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <Card style={{ textAlign: 'center' as const }}>
          <div style={{ fontSize: '11px', color: C.gray, textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Usuarios activos</div>
          <div style={{ fontSize: '32px', fontWeight: '700', color: C.accent }}>{usuarios.length}</div>
        </Card>
        <Card style={{ textAlign: 'center' as const }}>
          <div style={{ fontSize: '11px', color: C.gray, textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Tokens totales</div>
          <div style={{ fontSize: '32px', fontWeight: '700', color: C.green }}>150M</div>
        </Card>
        <Card style={{ textAlign: 'center' as const }}>
          <div style={{ fontSize: '11px', color: C.gray, textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Ingresos (mes)</div>
          <div style={{ fontSize: '32px', fontWeight: '700', color: C.yellow }}>12.450 €</div>
        </Card>
        <Card style={{ textAlign: 'center' as const }}>
          <div style={{ fontSize: '11px', color: C.gray, textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Modelos online</div>
          <div style={{ fontSize: '32px', fontWeight: '700', color: C.green }}>1/3</div>
        </Card>
      </div>

      <Card>
        <div style={{ fontSize: '14px', fontWeight: '700', color: C.white, marginBottom: '16px' }}>Usuarios registrados</div>
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                {['Email', 'Nombre', 'Rol', 'Tokens comprados', 'Saldo', 'Registro'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left' as const, color: C.gray, fontWeight: '600', fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} style={{ borderBottom: `1px solid ${C.cardBorder}22` }}>
                  <td style={{ padding: '12px 14px', color: C.white, fontWeight: '600' }}>{u.email}</td>
                  <td style={{ padding: '12px 14px', color: C.text }}>{u.nombre}</td>
                  <td style={{ padding: '12px 14px' }}><Badge color={u.rol === 'admin' ? C.red : C.green}>{u.rol}</Badge></td>
                  <td style={{ padding: '12px 14px', color: C.text }}>{(u.tokensComprados / 1000000).toFixed(1)}M</td>
                  <td style={{ padding: '12px 14px', color: u.saldo >= 0 ? C.green : C.red }}>{u.saldo.toFixed(2)} €</td>
                  <td style={{ padding: '12px 14px', color: C.gray }}>{u.fechaCreacion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: '14px', fontWeight: '700', color: C.white, marginBottom: '16px' }}>Claves API del sistema</div>
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                {['Nombre', 'Token', 'Propietario', 'Límite', 'Uso este mes', 'Estado'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left' as const, color: C.gray, fontWeight: '600', fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keysApi.map(k => (
                <tr key={k.id} style={{ borderBottom: `1px solid ${C.cardBorder}22` }}>
                  <td style={{ padding: '12px 14px', color: C.white, fontWeight: '600' }}>{k.nombre}</td>
                  <td style={{ padding: '12px 14px' }}><code style={{ color: C.gray, fontSize: '10px', backgroundColor: '#0d1117', padding: '4px 8px', borderRadius: '4px' }}>{k.token}</code></td>
                  <td style={{ padding: '12px 14px', color: C.text }}>Admin</td>
                  <td style={{ padding: '12px 14px', color: C.text }}>{k.limite}</td>
                  <td style={{ padding: '12px 14px', color: C.text }}>{k.uso}%</td>
                  <td style={{ padding: '12px 14px' }}><Badge color={k.estado === 'Activa' ? C.green : C.red}>{k.estado}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <label style={{ fontSize: '12px', color: C.gray, display: 'block', marginBottom: '6px' }}>Límite mensual (€) — dejar vacío para ilimitado</label>
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
    if (usuarioActual?.rol === 'admin') {
      return renderAdminDashboard();
    }

    switch (seccion) {
      case 'control': return renderControlCliente();
      case 'tokens': return renderCompraTokens();
      case 'claves': return renderClaves();
      case 'agentes': return renderAgentes();
      case 'sesiones': return renderSesiones();
      case 'analiticas': return renderAnaliticas();
      case 'recarga': return renderRecarga();
      default: return renderControlCliente();
    }
  };

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', backgroundColor: C.bg, color: C.text, display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>

      {/* ── SIDEBAR ── */}
      <aside style={{ width: '230px', backgroundColor: C.sidebar, borderRight: `1px solid ${C.cardBorder}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100vh', flexShrink: 0 }}>
        <div style={{ overflowY: 'auto' as const, padding: '14px 10px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: C.accentDim, borderRadius: '10px', border: `1px solid ${C.accent}33`, marginBottom: '18px' }}>
            <div style={{ fontSize: '18px', fontWeight: '700', color: C.accent }}>🚀 Zoco IA</div>
          </div>

          {/* Navegación */}
          {usuarioActual?.rol === 'admin' ? (
            <>
              {sectionLabel('ADMINISTRACIÓN')}
              {navItem('admin', '⚙️', 'Dashboard Admin')}
              {navItem('usuarios', '👥', 'Usuarios')}
              {navItem('facturacion', '💳', 'Facturación')}
              {navItem('modelos', '🤖', 'Modelos')}
              {navItem('auditoria', '📋', 'Auditoría')}
            </>
          ) : (
            <>
              {sectionLabel('CLIENTE')}
              {navItem('control', '📊', 'Panel de Control')}
              {navItem('tokens', '💰', 'Comprar Tokens')}
              {navItem('claves', '🔑', 'Claves API')}
              {navItem('agentes', '🤖', 'Agentes')}
              {navItem('sesiones', '⏱️', 'Sesiones')}
              {navItem('analiticas', '📈', 'Analíticas')}
            </>
          )}
        </div>

        {/* Footer con usuario */}
        <div style={{ padding: '14px 10px', borderTop: `1px solid ${C.cardBorder}` }}>
          <div style={{ backgroundColor: '#0d1117', borderRadius: '10px', padding: '12px', marginBottom: '10px' }}>
            <div style={{ fontSize: '11px', color: C.gray, marginBottom: '4px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Sesión actual</div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: C.white, wordBreak: 'break-all' as const }}>{usuarioActual?.email}</div>
            <div style={{ fontSize: '10px', color: C.gray, marginTop: '4px' }}>{usuarioActual?.rol === 'admin' ? '👑 Administrador' : '👤 Cliente'}</div>
          </div>
          <Btn onClick={handleLogout} style={{ width: '100%', fontSize: '12px' }}>
            Cerrar sesión
          </Btn>
        </div>
      </aside>

      {/* ── CONTENIDO PRINCIPAL ── */}
      <main style={{ flex: 1, overflowY: 'auto' as const, backgroundColor: C.bg }}>
        {renderContenido()}
      </main>

      {/* ── MODALES ── */}
      {modalNuevaKey && renderModalKey()}
      {modalNuevoAgente && renderModalAgente()}
    </div>
  );
}
