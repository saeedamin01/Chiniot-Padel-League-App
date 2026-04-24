/* eslint-disable @typescript-eslint/no-explicit-any */
// Service-worker custom code — compiled by @ducanh2912/next-pwa into sw.js
// We cast events explicitly because tsconfig includes lib.dom which conflicts
// with the webworker types for `self`.

// ─── Push notification received ──────────────────────────────────────────────
self.addEventListener('push', (event: any) => {
  if (!event.data) return

  let payload: {
    title?: string
    body?: string
    url?: string
    icon?: string
    tag?: string
  } = {}

  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'CPL', body: event.data.text() }
  }

  const title   = payload.title ?? 'Chiniot Padel League'
  const options = {
    body:    payload.body ?? '',
    icon:    payload.icon ?? '/icons/icon-192.svg',
    badge:   '/icons/icon-192.svg',
    tag:     payload.tag ?? 'cpl-notification',
    data:    { url: payload.url ?? '/' },
    vibrate: [200, 100, 200],
  }

  event.waitUntil((self as any).registration.showNotification(title, options))
})

// ─── Clear all notifications when the app comes into focus ───────────────────
// Any open CPL window gaining focus dismisses all pending notifications,
// matching the behaviour of WhatsApp and most native apps.
self.addEventListener('message', (event: any) => {
  if (event.data?.type === 'APP_FOCUSED') {
    (self as any).registration.getNotifications().then((notifications: any[]) => {
      notifications.forEach((n: any) => n.close())
    })
  }
})

// ─── Notification clicked ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event: any) => {
  event.notification.close()

  const targetUrl: string = event.notification.data?.url ?? '/'

  event.waitUntil(
    (self as any).clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList: any[]) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus()
            client.navigate?.(targetUrl)
            return
          }
        }
        return (self as any).clients.openWindow(targetUrl)
      })
  )
})
