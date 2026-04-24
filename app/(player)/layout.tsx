'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/layout/Navbar'
import { BottomNav } from '@/components/layout/BottomNav'
import { PushNotificationManager } from '@/components/PushNotificationManager'
import { createClient } from '@/lib/supabase/client'
import { TeamProvider } from '@/context/TeamContext'
import { ChatProvider } from '@/context/ChatContext'
import { toast } from 'sonner'

interface NavbarUser {
  id: string
  email: string
  name: string
  avatar_url?: string
  is_admin: boolean
}

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<NavbarUser | null>(null)
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  // Clear all push notifications when the app window comes into focus
  useEffect(() => {
    const clearNotifications = () => {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'APP_FOCUSED' })
      }
    }
    clearNotifications() // clear on mount (app opened)
    window.addEventListener('focus', clearNotifications)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') clearNotifications()
    })
    return () => {
      window.removeEventListener('focus', clearNotifications)
    }
  }, [])

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser()
        if (!authUser) { router.push('/login'); return }

        const [profileRes, seasonRes] = await Promise.all([
          supabase.from('players').select('id, email, name, avatar_url, is_admin, is_active, email_verified').eq('id', authUser.id).single(),
          supabase.from('seasons').select('id').eq('is_active', true).single(),
        ])

        if (profileRes.error || !profileRes.data) {
          // Orphaned auth user (no player profile) — sign out and send to login
          await supabase.auth.signOut()
          router.push('/login?error=no_profile')
          return
        }

        // Gate: suspended players cannot access the app
        if (profileRes.data.is_active === false) {
          await supabase.auth.signOut()
          router.push('/login?error=suspended')
          return
        }

        // Gate: player must verify their email before accessing the app
        if (!profileRes.data.email_verified) {
          router.push('/verify-email')
          return
        }

        setUser(profileRes.data as NavbarUser)
        if (seasonRes.data) setSeasonId(seasonRes.data.id)
      } catch (err) {
        toast.error('An error occurred while loading your profile')
      } finally {
        setLoading(false)
      }
    }

    fetchUserData()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) router.push('/login')
    })
    return () => { subscription?.unsubscribe() }
  }, [router, supabase])

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut()
      toast.success('Logged out successfully')
      router.push('/login')
    } catch {
      toast.error('Failed to logout')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse">
          <div className="h-8 w-32 bg-slate-800 rounded-lg" />
        </div>
      </div>
    )
  }

  const content = (
    <div className="min-h-screen bg-background">
      {user && (
        <Navbar
          isAdmin={user.is_admin}
          userAvatar={user.avatar_url}
          userName={user.name}
          userEmail={user.email}
          onLogout={handleLogout}
        />
      )}
      {/* pwa-main handles safe-area padding on mobile, regular py-8 on desktop */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 md:py-8 pwa-main">
        {children}
      </main>
      {/* Bottom tab navigation — mobile only, replaces hamburger menu */}
      <BottomNav />
      {/* Silently subscribe to push notifications after login */}
      <PushNotificationManager />
    </div>
  )

  // Wrap with TeamProvider + ChatProvider only when we have both user and season
  if (user && seasonId) {
    return (
      <TeamProvider userId={user.id} seasonId={seasonId}>
        <ChatProvider userId={user.id}>
          {content}
        </ChatProvider>
      </TeamProvider>
    )
  }

  // Wrap with just ChatProvider if we have a user but no season yet
  if (user) {
    return (
      <ChatProvider userId={user.id}>
        {content}
      </ChatProvider>
    )
  }

  return content
}
