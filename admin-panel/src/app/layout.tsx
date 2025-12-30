import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/core/Toast';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'CMS Admin Panel',
  description: 'Contest Management System Administration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ToastProvider>
           {children}
        </ToastProvider>
      </body>
    </html>
  );
}
