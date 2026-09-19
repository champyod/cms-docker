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
        {/* Why: 5000ms is the admin panel's long-standing toast lifetime, kept as the single default now that sonner is the only system. */}
        <Toaster richColors position="bottom-right" closeButton duration={5000} />
      </body>
    </html>
  );
}
