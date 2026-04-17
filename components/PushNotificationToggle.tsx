'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const DISMISSED_KEY = 'cpl-push-dismissed'

type State = 'unsupported' | 'loading' | 'denied' | 'subscribed' | 'unsubscribed'

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

async function removeFromDB(endpoint: string) {
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  })
}

export function PushNotificationToggle() {
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !VAPID_PUBLIC_KEY
    ) {
      setState('unsupported')
      return
    }

    const check = async () => {
      const permission = Notification.permission
      if (permission === 'denied') { setState('denied'); return }

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setState(sub ? 'subscribed' : 'unsubscribed')
    }

    check().catch(() => setState('unsupported'))
  }, [])

  const handleEnable = async () => {
    setState('loading')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState('denied')
        toast.error('Notifications blocked — enable them in your device settings.')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: VAPID_PUBLIC_KEY,
      })
      await saveToDB(sub)
      // Clear the "not now" flag so the banner won't be permanently hidden
      localStorage.removeItem(DISMISSED_KEY)
      setState('subscribed')
      toast.success('Push notifications enabled!')
    } catch (err) {
      console.error(err)
      setState('unsubscribed')
      toast.error('Could not enable notifications.')
    }
  }

  const handleDisable = async () => {
    setState('loading')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await removeFromDB(sub.endpoint)
        await sub.unsubscribe()
      }
      setState('unsubscribed')
      toast.success('Push notifications disabled.')
    } catch (err) {
      console.error(err)
      setState('subscribed')
      toast.error('Could not disable notifications.')
    }
  }

  if (state === 'unsupported') return null

  return (
    <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
      <div className="flex items-center gap-3">
        {state === 'subscribed'
          ? <Bell className="h-4 w-4 text-emerald-400" />
          : <BellOff className="h-4 w-4 text-slate-400" />
        }
        <div>
          <p className="text-sm font-medium text-white">Push notifications</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {state === 'subscribed'  && 'You will receive challenge and match alerts'}
            {state === 'unsubscribed' && 'Enable to receive challenge and match alerts'}
            {state === 'denied'       && 'Blocked — enable in your device settings'}
            {state === 'loading'      && 'Updating…'}
          </p>
        </div>
      </div>

      {state === 'loading' && (
        <Loader2 className="h-4 w-4 text-slate-400 animate-spin" />
      )}
      {state === 'subscribed' && (
        <button
          onClick={handleDisable}
          className="text-xs text-red-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-lg hover:bg-red-400/10 transition-colors"
        >
          Turn off
        </button>
      )}
      {state === 'unsubscribed' && (
        <button
          onClick={handleEnable}
          className="text-xs text-emerald-400 hover:text-emerald-300 font-medium px-3 py-1.5 rounded-lg hover:bg-emerald-400/10 transition-colors"
        >
          Turn on
        </button>
      )}
      {state === 'denied' && (
        <span className="text-xs text-slate-500 px-3 py-1.5">Blocked</span>
      )}
    </div>
  )
}
