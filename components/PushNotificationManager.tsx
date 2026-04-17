'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, X } from 'lucide-react'
import { toast } from 'sonner'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const DISMISSED_KEY = 'cpl-push-dismissed'

async function saveToDB(subscription: PushSubscription) {
  const json = subscription.toJSON()
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    }),
  })
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  try {
    const reg = await navigator.serviceWorker.ready
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

/**
 * Shows a small banner prompting the user to enable push notifications.
 * Uses a button tap to trigger permission — required on iOS PWA (Apple blocks auto-prompts).
 * Auto-subscribes silently on Android/Chrome where permission is already granted.
 */
export function PushNotificationManager() {
  const [showBanner, setShowBanner] = useState(false)
  const [loading, setLoading]       = useState(false)

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !VAPID_PUBLIC_KEY
    ) return

    // Don't show if user already dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return

    const check = async () => {
      const permission = Notification.permission

      if (permission === 'denied') return // user blocked — never ask again

      const existing = await getCurrentSubscription()

      if (existing) {
        // Already subscribed — silently sync to DB
        await saveToDB(existing)
        return
      }

      if (permission === 'granted') {
        // Permission granted but no subscription — subscribe silently (Android/Chrome)
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: VAPID_PUBLIC_KEY,
        })
        await saveToDB(sub)
        return
      }

      // permission === 'default' — need to ask via user gesture (iOS requirement)
      // Show banner after 2 s
      setTimeout(() => setShowBanner(true), 2000)
    }

    check().catch(console.error)
  }, [])

  const handleEnable = async () => {
    setLoading(true)
    try {
      if (!VAPID_PUBLIC_KEY) {
        toast.error('Push not configured — contact admin.')
        setShowBanner(false)
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        toast.error('Notifications blocked. Enable them in your device settings.')
        setShowBanner(false)
        localStorage.setItem(DISMISSED_KEY, '1')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: VAPID_PUBLIC_KEY,
      })
      await saveToDB(sub)
      localStorage.removeItem(DISMISSED_KEY)
      toast.success('Push notifications enabled!')
      setShowBanner(false)
    } catch (err) {
      console.error('Push subscribe error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Could not enable: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDismiss = () => {
    setShowBanner(false)
    localStorage.setItem(DISMISSED_KEY, '1')
  }

  if (!showBanner) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] md:top-auto md:bottom-24 md:left-4 md:right-auto md:max-w-sm">
      {/* Safe area spacer on mobile so banner sits below Dynamic Island */}
      <div className="pwa-header md:hidden" />
      <div className="mx-4 md:mx-0 mt-2 md:mt-0 bg-slate-900 border border-emerald-500/30 rounded-2xl p-4 shadow-2xl shadow-black/40 flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5 w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <Bell className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Enable notifications</p>
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
            Get notified about challenges, match results, and league updates.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleEnable}
              disabled={loading}
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-slate-950 text-xs font-semibold py-2 px-3 rounded-xl transition-colors"
            >
              {loading ? 'Enabling…' : 'Enable'}
            </button>
            <button
              onClick={handleDismiss}
              className="text-xs text-slate-500 hover:text-slate-300 py-2 px-3 rounded-xl hover:bg-slate-800 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
        <button onClick={handleDismiss} className="flex-shrink-0 text-slate-600 hover:text-slate-400 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
