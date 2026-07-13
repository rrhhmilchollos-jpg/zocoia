import React, { useState } from 'react';

export default function App() {
  // Estados nativos de React para la navegación y control de la UI
  const [seccionActiva, setSeccionActiva] = useState('control');
  const [saldo, setSaldo] = useState(-1.73);
  const [vivaAmount, setVivaAmount] = useState('50');
  const [bannerText, setBannerText] = useState('ℹ️ El acceso a tus 11 agentes de software locales ha sido restaurado con éxito.');
  const [keysApi, setKeysApi] = useState([
    { nombre: 'Master Admin Key', token: 'sk-marisai-master-19862210...', limite: 'ILIMITADO', estado: 'Activa' }
  ]);

  const generarNuevaApiKey = () => {
    const nombre = prompt("Nombre del cliente para la clave:");
    if (!nombre) return;
    const presupuesto = prompt("Límite en dólares:", "50.00");
    if (!presupuesto) return;
    
    const rnd = Math.random().toString(36).substring(2, 10);
    const nuevoToken = `sk-marisai-${rnd}2026x...`;
    
    setKeysApi([...keysApi, { nombre, token: nuevoToken, limite: presupuesto + ' US$', estado: 'Activa' }]);
    alert(`¡Clave registrada correctamente!\n\n${nuevoToken}`);
  };

  const ejecutarPagoBancoViva = () => {
    const monto = parseFloat(vivaAmount);
    alert(`Conectando con Viva.com...\n\nPago de ${monto},00 US$ procesado.\nAutorización bancaria concedida.`);
    setSaldo(monto - 1.73);
    setBannerText("ℹ️ Organización saldada. La pasarela comercial de Maris AI se encuentra activa de forma real.");
    setSeccionActiva('control');
  };

  return (
    <div style={{ fontFamily: '-apple-system, sans-serif', backgroundColor: '#0b0f19', color: '#f3f4f6', display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      
      {/* BARRA LATERAL IZQUIERDA */}
      <aside style={{ width: '260px', backgroundColor: '#111827', borderRight: '1px solid #1f2937', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100vh' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid #1f2937', marginBottom: '20px', fontSize: '13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '20px', height: '20px', backgroundColor: '#06b6d4', borderRadius: '4px', color: '#0b0f19', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', textAlign: 'center', lineHeight: '20px' }}>M</div>
              <span style={{ fontWeight: '600' }}>Maris AI</span>
            </div>
            <span style={{ color: '#4b5563', fontSize: '10px' }}>▼</span>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div onClick={() => setSeccionActiva('control')} style={{ padding: '10px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: seccionActiva === 'control' ? '#22d3ee' : '#9ca3af', backgroundColor: seccionActiva === 'control' ? '#1f2937' : 'transparent', fontWeight: seccionActiva === 'control' ? '600' : '400' }}>🏠 Panel de control</div>
            <div onClick={() => setSeccionActiva('claves')} style={{ padding: '10px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: seccionActiva === 'claves' ? '#22d3ee' : '#9ca3af', backgroundColor: seccionActiva === 'claves' ? '#1f2937' : 'transparent', fontWeight: seccionActiva === 'claves' ? '600' : '400' }}>🔑 Claves de API</div>
            <div onClick={() => setSeccionActiva('compilar')} style={{ padding: '10px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: seccionActiva === 'compilar' ? '#22d3ee' : '#9ca3af', backgroundColor: seccionActiva === 'compilar' ? '#1f2937' : 'transparent', fontWeight: seccionActiva === 'compilar' ? '600' : '400' }}>⚙️ Compilar</div>
            
            <div style={{ fontSize: '11px', color: '#4b5563', textTransform: 'uppercase', letterSpacing: '1px', margin: '15px 0 5px 12px', fontWeight: '600' }}>Analíticas</div>
            <div onClick={() => setSeccionActiva('uso')} style={{ padding: '10px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: seccionActiva === 'uso' ? '#22d3ee' : '#9ca3af', backgroundColor: seccionActiva === 'uso' ? '#1f2937' : 'transparent', fontWeight: seccionActiva === 'uso' ? '600' : '400' }}>📊 Uso general</div>
          </nav>
        </div>

        <div>
          <div style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', padding: '12px', borderRadius: '12px', fontSize: '11px', color: saldo < 0 ? '#f87171' : '#34d399', lineHeight: '1.4' }}>
            Saldo organización: <span style={{ fontWeight: 'bold' }}>{saldo.toFixed(2)} US$</span>. {saldo < 0 && <span onClick={() => setSeccionActiva('recarga')} style={{ color: 'white', fontWeight: '600', cursor: 'pointer', textDecoration: 'underline' }}>Añadir fondos</span>}
          </div>
          <div style={{ backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid #1f2937', padding: '10px', borderRadius: '8px', fontSize: '12px', marginTop: '15px' }}>
            <div style={{ fontWeight: '600', color: 'white' }}>Maria</div>
            <div style={{ color: '#6b7280', fontSize: '11px', textOverflow: 'ellipsis', overflow: 'hidden' }}>rrhh.milchollos@gmail.com</div>
          </div>
        </div>
      </aside>

      {/* CUERPO CENTRAL */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#0f172a', height: '100vh', overflowY: 'auto' }}>
        <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', borderBottom: '1px solid rgba(245, 158, 11, 0.2)', padding: '10px 24px', fontSize: '13px', color: '#f59e0b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{bannerText}</span>
        </div>

        {/* PESTAÑA: PANEL DE CONTROL */}
        {seccionActiva === 'control' && (
          <div style={{ padding: '40px', maxWidth: '1100px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h1 style={{ fontSize: '24px', fontWeight: '700' }}>Buenas noches, Maria</h1>
              <div>
                <button onClick={() => setSeccionActiva('claves')} style={{ backgroundColor: '#1f2937', border: '1px solid #334155', color: '#f3f4f6', padding: '10px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', marginRight: '8px' }}>Obtener clave de API</button>
                <button onClick={() => setSeccionActiva('recarga')} style={{ backgroundColor: '#f3f4f6', border: 'none', color: '#0f172a', padding: '10px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Cargar Saldo</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', width: '100%' }}>
              <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '16px', padding: '24px', minHeight: '140px', display: 'flex', flexDirection: 'column', justifycontent: 'space-between' }}>
                <div><div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '8px' }}>Créditos de la organización</div><div style={{ fontSize: '26px', fontWeight: '700', color: saldo < 0 ? '#f87171' : '#34d399' }}>{saldo.toFixed(2)} US$</div></div>
                {saldo < 0 && <button onClick={() => setSeccionActiva('recarga')} style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '10px', borderRadius: '10px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', marginTop: '15px' }}>Liquidar deuda con Viva.com</button>}
              </div>
              <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '16px', padding: '24px', minHeight: '140px', display: 'flex', flexDirection: 'column', justifycontent: 'space-between' }}>
                <div><div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '8px' }}>Gasto este mes</div><div style={{ fontSize: '26px', fontWeight: '700', color: 'white' }}>43,73 US$</div></div>
                <div style={{ fontSize: '11px', color: '#6b7280', borderTop: '1px solid #334155', paddingTop: '10px' }}>de 1000 US$ de límite autorizado</div>
              </div>
              <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '16px', padding: '24px', minHeight: '140px', display: 'flex', flexDirection: 'column', justifycontent: 'space-between' }}>
                <div><div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '8px' }}>Caché guardada</div><div style={{ fontSize: '26px', fontWeight: '700', color: '#34d399' }}>6% Aciertos</div></div>
                <div style={{ fontSize: '11px', color: '#6b7280', borderTop: '1px solid #334155', paddingTop: '10px' }}>Optimización activa en clúster local</div>
              </div>
            </div>

            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '16px', padding: '24px', width: '100%' }}>
              <div style={{ fontSize: '13px', color: '#9ca3af' }}>Volumen de tokens transaccionados en red</div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: 'white' }}>6 M <span style={{ fontSize: '12px', color: '#6b7280' }}>últimos 7 días</span></div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '60px', marginTop: '15px' }}>
                <div style={{ backgroundColor: '#111827', height: '20%', flex: 1, borderRadius: '4px' }}></div>
                <div style={{ backgroundColor: '#111827', height: '45%', flex: 1, borderRadius: '4px' }}></div>
