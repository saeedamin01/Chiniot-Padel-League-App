'use client'

import React, { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, Loader2, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const router       = useRouter()

  const token    = searchParams.get('token')
  const error    = searchParams.get('error')
  const verified = searchParams.get('verified')

  const [status, setStatus]   = useState<'verifying' | 'success' | 'error' | 'pending'>('pending')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (token) {
      setStatus('verifying')
      // The API handles verification and redirects back here with ?verified=1 or ?error=...
      router.replace(`/api/auth/verify-email?token=${token}`)
      return
    }
    if (verified === '1') { setStatus('success'); return }
    if (error) {
      setStatus('error')
      const msgs: Record<string, string> = {
        missing_token: 'No verification token was found in the link.',
        invalid_token: 'This link is invalid or has already been used.',
        expired_token: 'This link has expired. Please contact the admin to resend it.',
      }
      setErrorMsg(msgs[error] ?? 'Something went wrong.')
      return
    }
    setStatus('pending')
  }, [token, error, verified, router])

  if (status === 'verifying') return (
    <div className="bg-slate-800/60 backdrop-blur border border-slate-700/50 rounded-2xl p-8 shadow-2xl text-center space-y-4">
      <Loader2 className="h-10 w-10 text-emerald-400 mx-auto animate-spin" />
      <h2 className="text-xl font-bold text-white">Verifying your email…</h2>
    </div>
  )

  if (status === 'success') return (
    <div className="bg-slate-800/60 backdrop-blur border border-slate-700/50 rounded-2xl p-8 shadow-2xl text-center space-y-5">
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/15 mx-auto">
        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white">Email Verified!</h2>
        <p className="text-slate-400 text-sm">You can now sign in with your temporary password and change it from your profile.</p>
      </div>
      <Link href="/login"><Button className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold">Sign In</Button></Link>
    </div>
  )

  if (status === 'error') return (
    <div className="bg-slate-800/60 backdrop-blur border border-slate-700/50 rounded-2xl p-8 shadow-2xl text-center space-y-5">
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500/15 mx-auto">
        <XCircle className="h-8 w-8 text-red-400" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white">Verification Failed</h2>
        <p className="text-slate-400 text-sm">{errorMsg}</p>
      </div>
      <Link href="/login"><Button variant="outline" className="w-full border-slate-600 text-slate-300">Back to Sign In</Button></Link>
    </div>
  )

  // Default: no token in URL — "check your email" screen
  return (
    <div className="bg-slate-800/60 backdrop-blur border border-slate-700/50 rounded-2xl p-8 shadow-2xl text-center space-y-5">
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 mx-auto">
        <Mail className="h-8 w-8 text-emerald-400" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white">Check Your Email</h2>
        <p className="text-slate-400 text-sm leading-relaxed">A verification link has been sent to your email address. Click it to activate your account.</p>
        <p className="text-slate-500 text-xs">Don't see it? Check your spam folder.</p>
      </div>
      <Link href="/login"><Button variant="outline" className="w-full border-slate-600 text-slate-300">Back to Sign In</Button></Link>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="bg-slate-800/60 backdrop-blur border border-slate-700/50 rounded-2xl p-8 shadow-2xl text-center">
        <Loader2 className="h-10 w-10 text-emerald-400 mx-auto animate-spin" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  )
}
