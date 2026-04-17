/// <reference lib="webworker" />
export type {}

// ─── Push notification received ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
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

  const title = payload.title ?? 'Chiniot Padel League'
  const options: NotificationOptions = {
    body:    payload.body ?? '',
    icon:    payload.icon ?? '/icons/icon-192.svg',
    badge:   '/icons/icon-192.svg',
    tag:     payload.tag ?? 'cpl-notification',
    data:    { url: payload.url ?? '/' },
    // @ts-expect-error — vibrate is valid but not in all TS lib types
    vibrate: [200, 100, 200],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ─── Notification clicked ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl: string = event.notification.data?.url ?? '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open, focus it and navigate
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus()
            client.navigate?.(targetUrl)
            return
          }
        }
        // Otherwise open a new window
        return self.clients.openWindow(targetUrl)
      })
  )
})
