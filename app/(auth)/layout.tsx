import React from 'react'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* CPL Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🎾</div>
          <h1 className="text-2xl font-bold text-white">Chiniot Padel League</h1>
          <p className="text-slate-400 text-sm mt-1">Season 3 — Official App</p>
        </div>
        {children}
      </div>
    </div>
  )
}
