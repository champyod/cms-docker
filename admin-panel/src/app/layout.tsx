import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
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
  const rootClassName = ['dark', geistSans.variable, geistMono.variable].join(' ');

  return (
    <html lang="en" className={rootClassName} suppressHydrationWarning>
      <body className="font-sans antialiased">
        {children}
        <Toaster richColors position="bottom-right" closeButton />
      </body>
    </html>
  );
}
