'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Loader2, Mail, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const router = useRouter()
  const supabase = createClient()

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!email) {
      newErrors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Please enter a valid email address'
    }

    if (!password) {
      newErrors.password = 'Password is required'
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        toast.error(error.message || 'Failed to sign in')
        setLoading(false)
        return
      }

      toast.success('Welcome back!')
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      toast.error('An unexpected error occurred')
      setLoading(false)
    }
  }

  return (
    <div className="bg-slate-800/60 backdrop-blur border border-slate-700/50 rounded-2xl p-8 shadow-2xl space-y-6">
      <h2 className="text-2xl font-bold text-white">Sign In</h2>

      <form onSubmit={handleLogin} className="space-y-4">
        {/* Email Field */}
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-slate-200">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="h-4 w-4 text-emerald-500" />
              Email Address
            </div>
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (errors.email) setErrors({ ...errors, email: '' })
            }}
            placeholder="you@example.com"
            className={`w-full px-4 py-2 rounded-lg bg-slate-700/50 border transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-400 ${
              errors.email
                ? 'border-red-500/50 focus:border-red-500'
                : 'border-slate-600/50 focus:border-emerald-500'
            }`}
          />
          {errors.email && <p className="text-red-400 text-sm">{errors.email}</p>}
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-slate-200">
            <div className="flex items-center gap-2 mb-2">
              <Lock className="h-4 w-4 text-emerald-500" />
              Password
            </div>
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (errors.password) setErrors({ ...errors, password: '' })
            }}
            placeholder="••••••••"
            className={`w-full px-4 py-2 rounded-lg bg-slate-700/50 border transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-400 ${
              errors.password
                ? 'border-red-500/50 focus:border-red-500'
                : 'border-slate-600/50 focus:border-emerald-500'
            }`}
          />
          {errors.password && <p className="text-red-400 text-sm">{errors.password}</p>}
        </div>

        {/* Remember Me Checkbox */}
        <div className="flex items-center gap-2">
          <input
            id="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-700 cursor-pointer accent-emerald-500"
          />
          <label htmlFor="rememberMe" className="text-sm text-slate-300 cursor-pointer">
            Remember me
          </label>
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={loading}
          className="w-full h-10 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>

      {/* Invite-only notice */}
      <div className="text-center pt-4 border-t border-slate-700">
        <p className="text-slate-500 text-xs">
          Player accounts are created by the league admin.
        </p>
      </div>
    </div>
  )
}
