import React from 'react';
import { Link } from 'react-router-dom';

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white">
      <div className="max-w-md w-full space-y-8 p-10 bg-[#1a1a1a] rounded-xl border border-white/10">
        <h2 className="text-center text-3xl font-bold">Restablecer contraseña</h2>
        <p className="text-center text-gray-400">Próximamente disponible</p>
        <div className="text-center">
          <Link to="/login" className="text-[#d97757] hover:underline">Volver al login</Link>
        </div>
      </div>
    </div>
  );
}
