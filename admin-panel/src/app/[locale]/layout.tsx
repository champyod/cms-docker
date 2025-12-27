import { ToastProvider } from '@/components/providers/ToastProvider';

export default async function LocaleLayout({
  children,
}: {
    children: React.ReactNode;
}) {
  return <ToastProvider>{children}</ToastProvider>;
}
