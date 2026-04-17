'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

/**
 * Silently subscribes the logged-in player to Web Push after a brief delay.
 * - Does nothing if notifications are denied or already subscribed.
 * - Shows a one-time toast prompting the user to enable notifications
 *   only if permission is currently "default" (not yet asked).
 */
export function PushNotificationManager() {
  const asked = useRef(false)

  useEffect(() => {
    if (asked.current) return
    asked.current = true

    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !VAPID_PUBLIC_KEY
    ) return

    const subscribe = async () => {
      try {
        const registration = await navigator.serviceWorker.ready

        // Check existing subscription first
        const existing = await registration.pushManager.getSubscription()
        if (existing) {
          // Already subscribed — make sure it's saved in our DB
          await saveToDB(existing)
          return
        }

        // Not yet subscribed — request permission
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return

        // Subscribe with our VAPID public key
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })

        await saveToDB(subscription)
        toast.success('Push notifications enabled!')
      } catch (err) {
        console.error('Push subscription failed:', err)
      }
    }

    // Wait 3 s after mount so it doesn't fire immediately on login
    const timer = setTimeout(subscribe, 3000)
    return () => clearTimeout(timer)
  }, [])

  return null
}

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
