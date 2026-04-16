import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemedToaster } from "@/components/ui/ThemedToaster";

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#10b981' },
    { media: '(prefers-color-scheme: light)', color: '#059669' },
  ],
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  viewportFit: 'cover',      // respects iPhone notch / Dynamic Island
}

export const metadata: Metadata = {
  title: {
    default: 'Chiniot Padel League',
    template: '%s | CPL',
  },
  description: 'Official ladder management system for Chiniot Padel League',
  manifest: '/manifest.webmanifest',
  applicationName: 'Chiniot Padel League',
  appleWebApp: {
    capable: true,
    title: 'CPL',
    statusBarStyle: 'black-translucent',   // lets the status bar blend with the app
  },
  formatDetection: {
    telephone: false,   // prevent iOS auto-linking phone numbers
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { url: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.svg', sizes: '180x180', type: 'image/svg+xml' },
    ],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="scroll-smooth">
      <head>
        {/* Splash screen background colour for iOS PWA loading */}
        <meta name="msapplication-TileColor" content="#064e3b" />
      </head>
      <body className="font-sans bg-background text-foreground min-h-screen antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
