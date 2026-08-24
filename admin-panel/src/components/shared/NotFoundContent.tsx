'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NotFoundContent() {
  const pathname = usePathname();
  const locale = pathname?.split('/')[1] || 'en';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
      <div className="text-center space-y-6">
        <div className="space-y-2">
          <p className="text-8xl font-bold text-muted-foreground/20 select-none">404</p>
          <h1 className="text-2xl font-semibold text-foreground">Page Not Found</h1>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-sm font-medium transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
