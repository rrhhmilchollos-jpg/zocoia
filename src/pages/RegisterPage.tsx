import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout';
import PasswordInput from '../components/PasswordInput';
import { useAuth } from '../context/AuthContext';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    setLoading(true);
    const result = await register(email, password, nombre);
    setLoading(false);
    if (!result.ok) {
      setError(result.error || 'No se pudo crear la cuenta');
      return;
    }
    navigate('/');
  };

  return (
    <AuthLayout title="Crea tu cuenta" subtitle="Regístrate para empezar a usar Zoco IA">
      <form onSubmit={handleSubmit} className="space-y-4 text-[14px]">
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 text-[13px] px-3 py-2 rounded-lg">{error}</div>
        )}
        <div>
          <label htmlFor="nombre" className="block text-gray-600 mb-1 text-[13px] font-medium">Nombre</label>
          <input
            id="nombre"
            type="text"
            required
            autoComplete="name"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Tu nombre"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-black/80 focus:border-transparent"
          />
        </div>
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
          <label htmlFor="password" className="block text-gray-600 mb-1 text-[13px] font-medium">Contraseña</label>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" required />
          <p className="text-[11px] text-gray-400 mt-1">Mínimo 8 caracteres</p>
        </div>
        <div>
          <label htmlFor="confirmPassword" className="block text-gray-600 mb-1 text-[13px] font-medium">Confirmar contraseña</label>
          <PasswordInput id="confirmPassword" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" required />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-60"
        >
          {loading ? 'Creando cuenta...' : 'Crear cuenta'}
        </button>
      </form>
      <p className="text-center text-[13px] text-gray-500 mt-6">
        ¿Ya tienes cuenta? <Link to="/login" className="text-blue-600 hover:underline font-medium">Inicia sesión</Link>
      </p>
    </AuthLayout>
  );
}
