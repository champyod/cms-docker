import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { NO_FLASH_THEME_SCRIPT } from '@/lib/theme';
import { NO_FLASH_DISPLAY_SCRIPT } from '@/lib/display-density';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

// Why: 64px is the mobile bottom bar's h-16 track, plus 24px of breathing room so the toast stack clears it.
const MOBILE_BOTTOM_BAR_HEIGHT_PX = 64;
const TOAST_BREATHING_GAP_PX = 24;
// env(safe-area-inset-bottom) mirrors the bottom bar's own pb-[env(safe-area-inset-bottom)] on notched phones.
const MOBILE_TOAST_BOTTOM_OFFSET = `calc(${MOBILE_BOTTOM_BAR_HEIGHT_PX + TOAST_BREATHING_GAP_PX}px + env(safe-area-inset-bottom))`;

export const metadata: Metadata = {
  title: 'CMS Admin Panel',
  description: 'Contest Management System Administration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const rootClassName = [geistSans.variable, geistMono.variable].join(' ');

  return (
    <html lang="en" className={rootClassName} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_DISPLAY_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        {children}
        {/* Why: 5000ms is the admin panel's long-standing toast lifetime, kept as the single default now that sonner is the only system. mobileOffset lifts the toast stack above the fixed mobile bottom bar (64px + safe area) inside sonner's own max-width:600px query, so the "More" control stays tappable; desktop bottom-right offset is untouched. */}
        <Toaster richColors position="bottom-right" closeButton duration={5000} mobileOffset={{ bottom: MOBILE_TOAST_BOTTOM_OFFSET }} />
      </body>
    </html>
  );
}
