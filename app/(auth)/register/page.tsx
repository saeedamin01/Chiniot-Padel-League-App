import Link from 'next/link'
import { Lock } from 'lucide-react'

export default function RegisterPage() {
  return (
    <div className="bg-slate-800/60 backdrop-blur border border-slate-700/50 rounded-2xl p-8 shadow-2xl space-y-6 text-center">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-slate-700/60 mx-auto">
        <Lock className="h-6 w-6 text-slate-400" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white">Invite Only</h2>
        <p className="text-slate-400 text-sm leading-relaxed">
          Player accounts for the Chiniot Padel League are created by the league admin.
          If you've been accepted into the league, your login details will be sent to you directly.
        </p>
      </div>

      <Link
        href="/login"
        className="inline-block w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-sm transition-colors"
      >
        Back to Sign In
      </Link>
    </div>
  )
}
