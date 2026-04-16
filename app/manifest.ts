import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Chiniot Padel League',
    short_name: 'CPL',
    description: 'Official ladder management system for Chiniot Padel League',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#10b981',
    orientation: 'portrait-primary',
    categories: ['sports', 'games'],
    icons: [
      {
        src: '/icons/icon-192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    screenshots: [],
    shortcuts: [
      {
        name: 'My Dashboard',
        url: '/dashboard',
        description: 'View your active challenges and match schedule',
        icons: [{ src: '/icons/icon-192.svg', sizes: '192x192' }],
      },
      {
        name: 'Ladder',
        url: '/ladder',
        description: 'View the live ladder and send challenges',
        icons: [{ src: '/icons/icon-192.svg', sizes: '192x192' }],
      },
    ],
  }
}
