import React, { ReactNode } from 'react';

export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#fafafa] px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center space-x-2 mb-8">
          <div className="w-7 h-7 bg-black rounded flex items-center justify-center text-white text-xs font-bold">Z</div>
          <span className="font-semibold text-gray-800 text-lg">Zoco IA</span>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
          <h1 className="text-xl font-bold text-gray-900 mb-1">{title}</h1>
          {subtitle && <p className="text-gray-400 text-[13px] mb-6">{subtitle}</p>}
          {!subtitle && <div className="mb-4" />}
          {children}
        </div>
      </div>
    </div>
  );
}
