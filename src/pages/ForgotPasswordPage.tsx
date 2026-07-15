import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout';
import { API_BASE } from '../context/AuthContext';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('No se pudo procesar la solicitud');
      setSent(true);
    } catch (err) {
      setError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout title="Revisa tu correo">
        <p className="text-[14px] text-gray-600 leading-relaxed">
          Si <strong>{email}</strong> está registrado en Zoco IA, te hemos enviado un enlace para restablecer tu contraseña.
          El enlace caduca en 1 hora.
        </p>
        <Link to="/login" className="block text-center mt-6 text-[13px] text-blue-600 hover:underline font-medium">
          Volver a inicio de sesión
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="¿Olvidaste tu contraseña?" subtitle="Te enviaremos un enlace para restablecerla">
      <form onSubmit={handleSubmit} className="space-y-4 text-[14px]">
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 text-[13px] px-3 py-2 rounded-lg">{error}</div>
        )}
        <div>
          <label htmlFor="email" className="block text-gray-600 mb-1 text-[13px] font-medium">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@empresa.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-black/80 focus:border-transparent"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-60"
        >
          {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
        </button>
      </form>
      <p className="text-center text-[13px] text-gray-500 mt-6">
        <Link to="/login" className="text-blue-600 hover:underline font-medium">Volver a inicio de sesión</Link>
      </p>
    </AuthLayout>
  );
}
