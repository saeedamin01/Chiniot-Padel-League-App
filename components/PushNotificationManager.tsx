'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Smartphone, X } from 'lucide-react'
import { toast } from 'sonner'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const DISMISSED_KEY    = 'cpl-push-dismissed'
const IOS_HINT_KEY     = 'cpl-ios-push-hint-dismissed'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a URL-safe Base64 VAPID public key to the Uint8Array that
 * pushManager.subscribe({ applicationServerKey }) requires.
 * Passing a raw string works in Chrome/Edge but fails silently in
 * Firefox, Safari, and most mobile browsers.
 */
/**
 * Convert a URL-safe Base64 VAPID public key to an ArrayBuffer for
 * pushManager.subscribe({ applicationServerKey }).
 * Returns ArrayBuffer (not Uint8Array) to satisfy TypeScript 5.9+
 * generic Uint8Array constraint vs. the DOM BufferSource type.
 */
function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding   = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64    = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData   = window.atob(base64)
  const buffer    = new ArrayBuffer(rawData.length)
  const outputArr = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; i++) {
    outputArr[i] = rawData.charCodeAt(i)
  }
  return buffer
}

/** True when running inside a PWA installed on the iOS Home Screen. */
function isIosStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(window.navigator as any).standalone
}

/** True when the device is iOS (iPhone / iPad / iPod). */
function isIos(): boolean {
  if (typeof window === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

async function saveToDB(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON()
  const res = await fetch('/api/push/subscribe', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    }),
  })
  if (!res.ok) {
    console.warn('[CPL Push] saveToDB failed:', await res.text())
  }
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  try {
    const reg = await navigator.serviceWorker.ready
    return await reg.pushManager.getSubscription()
  } catch (err) {
    console.warn('[CPL Push] getSubscription error:', err)
    return null
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Handles the push-notification subscription lifecycle.
 *
 * Renders nothing once subscribed; shows a one-time banner when permission
 * hasn't been decided yet.
 *
 * iOS-specific behaviour:
 *  - iOS 16.4+ in standalone (Home Screen) mode: regular subscribe flow
 *  - iOS in Safari (not standalone): shows a "Add to Home Screen" hint instead
 */
export function PushNotificationManager() {
  const [showBanner, setShowBanner]   = useState(false)
  const [showIosHint, setShowIosHint] = useState(false)
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // ── iOS in Safari (not yet added to Home Screen) ──────────────────────
    if (isIos() && !isIosStandalone()) {
      // Push notifications require standalone mode on iOS.
      // Show a one-time hint guiding them to "Add to Home Screen".
      if (!localStorage.getItem(IOS_HINT_KEY)) {
        // Slight delay so it doesn't flash immediately on every page load
        setTimeout(() => setShowIosHint(true), 3000)
      }
      return
    }

    // ── Check push API availability ───────────────────────────────────────
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.info('[CPL Push] Push API not available in this browser.')
      return
    }
    if (!VAPID_PUBLIC_KEY) {
      console.warn('[CPL Push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set — push disabled.')
      return
    }

    // Already dismissed by user — don't nag them again
    if (localStorage.getItem(DISMISSED_KEY)) return

    const check = async () => {
      const permission = Notification.permission
      console.info('[CPL Push] Notification.permission =', permission)

      if (permission === 'denied') {
        console.info('[CPL Push] User has blocked notifications.')
        return
      }

      const existing = await getCurrentSubscription()

      if (existing) {
        console.info('[CPL Push] Existing subscription found — syncing to DB.')
        await saveToDB(existing)
        return
      }

      if (permission === 'granted') {
        // Already granted, no subscription yet — subscribe silently (Android/Chrome)
        console.info('[CPL Push] Permission granted, no sub yet — subscribing silently.')
        try {
          const reg = await navigator.serviceWorker.ready
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly:   true,
            applicationServerKey: urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY),
          })
          await saveToDB(sub)
          console.info('[CPL Push] Silent subscription saved.')
        } catch (err) {
          console.warn('[CPL Push] Silent subscribe failed:', err)
        }
        return
      }

      // permission === 'default' — need a user gesture to request permission.
      // Show banner after a short delay so it doesn't interfere with page load.
      setTimeout(() => setShowBanner(true), 2000)
    }

    check().catch(err => console.warn('[CPL Push] check() error:', err))
  }, [])

  // ── Subscribe handler (triggered by user tapping "Enable") ────────────────
  const handleEnable = async () => {
    setLoading(true)
    try {
      if (!VAPID_PUBLIC_KEY) {
        toast.error('Push not configured — contact admin.')
        setShowBanner(false)
        return
      }

      const permission = await Notification.requestPermission()
      console.info('[CPL Push] requestPermission result:', permission)

      if (permission !== 'granted') {
        toast.error('Notifications blocked. Enable them in your device settings.')
        setShowBanner(false)
        localStorage.setItem(DISMISSED_KEY, '1')
        return
      }

      const reg = await navigator.serviceWorker.ready
      console.info('[CPL Push] SW ready, subscribing…')

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:   true,
        applicationServerKey: urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY),
      })
      console.info('[CPL Push] Subscribed:', sub.endpoint)

      await saveToDB(sub)
      localStorage.removeItem(DISMISSED_KEY)
      toast.success('🔔 Push notifications enabled!')
      setShowBanner(false)
    } catch (err) {
      console.error('[CPL Push] subscribe error:', err)
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

  const handleDismissIosHint = () => {
    setShowIosHint(false)
    localStorage.setItem(IOS_HINT_KEY, '1')
  }

  // ── iOS "Add to Home Screen" hint ─────────────────────────────────────────
  if (showIosHint) {
    return (
      <div className="fixed bottom-24 left-4 right-4 z-[60] md:hidden">
        <div className="bg-slate-900 border border-blue-500/30 rounded-2xl p-4 shadow-2xl shadow-black/40 flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5 w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Smartphone className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">Enable push notifications</p>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              To receive CPL alerts on your iPhone, add this app to your Home Screen:
            </p>
            <ol className="text-xs text-slate-300 mt-1.5 space-y-0.5 list-decimal list-inside">
              <li>Tap the <span className="text-blue-400 font-medium">Share</span> button in Safari</li>
              <li>Choose <span className="text-blue-400 font-medium">Add to Home Screen</span></li>
              <li>Open CPL from your Home Screen</li>
            </ol>
            <p className="text-xs text-slate-500 mt-2">Requires iOS 16.4 or later.</p>
          </div>
          <button
            onClick={handleDismissIosHint}
            className="flex-shrink-0 text-slate-600 hover:text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  // ── Standard push permission banner ───────────────────────────────────────
  if (!showBanner) return null

  return (
    <div className="fixed bottom-24 left-4 right-4 z-[60] md:left-auto md:right-4 md:max-w-sm">
      <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-4 shadow-2xl shadow-black/40 flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5 w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <Bell className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Enable notifications</p>
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
            Get notified about challenges, match results, and disputes.
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
