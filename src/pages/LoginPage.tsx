import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout';
import PasswordInput from '../components/PasswordInput';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error || 'No se pudo iniciar sesión');
      return;
    }
    navigate('/');
  };

  return (
    <AuthLayout title="Inicia sesión" subtitle="Accede a tu panel de Zoco IA">
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
        <div>
          <div className="flex justify-between items-center mb-1">
            <label htmlFor="password" className="block text-gray-600 text-[13px] font-medium">Contraseña</label>
            <Link to="/olvide-password" className="text-[12px] text-blue-600 hover:underline">¿Olvidaste tu contraseña?</Link>
          </div>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" required />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-60"
        >
          {loading ? 'Entrando...' : 'Iniciar sesión'}
        </button>
      </form>
      <p className="text-center text-[13px] text-gray-500 mt-6">
        ¿No tienes cuenta? <Link to="/registro" className="text-blue-600 hover:underline font-medium">Regístrate</Link>
      </p>
    </AuthLayout>
  );
}
