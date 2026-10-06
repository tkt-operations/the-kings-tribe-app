import type { Metadata, Viewport } from "next";
import { dmSerif, satoshi } from "./fonts";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "The Kings Tribe — Finance & Operations",
    template: "%s · The Kings Tribe",
  },
  description: "Finance, attendance and requisitions for The Kings Tribe.",
  applicationName: "TKT Operations",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TKT Operations",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#12172D",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${satoshi.variable} ${dmSerif.variable}`}>
      <body className="min-h-dvh">
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
