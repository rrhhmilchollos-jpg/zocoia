import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout';
import PasswordInput from '../components/PasswordInput';
import { API_BASE } from '../context/AuthContext';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

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
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo restablecer la contraseña');
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err: any) {
      setError(err.message || 'No se pudo restablecer la contraseña');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Enlace no válido">
        <p className="text-[14px] text-gray-600">Este enlace de recuperación no es válido o está incompleto.</p>
        <Link to="/olvide-password" className="block text-center mt-6 text-[13px] text-blue-600 hover:underline font-medium">
          Solicitar un nuevo enlace
        </Link>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout title="¡Contraseña actualizada!">
        <p className="text-[14px] text-gray-600">Redirigiéndote a inicio de sesión...</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Crea una nueva contraseña" subtitle="Elige una contraseña segura para tu cuenta">
      <form onSubmit={handleSubmit} className="space-y-4 text-[14px]">
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 text-[13px] px-3 py-2 rounded-lg">{error}</div>
        )}
        <div>
          <label htmlFor="password" className="block text-gray-600 mb-1 text-[13px] font-medium">Nueva contraseña</label>
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
          {loading ? 'Guardando...' : 'Restablecer contraseña'}
        </button>
      </form>
    </AuthLayout>
  );
}
