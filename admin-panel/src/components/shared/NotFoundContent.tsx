'use client';

import { usePathname } from 'next/navigation';

import { LinkButton } from '@/components/core/LinkButton';
import { buildRoute } from '@/lib/navigation/routes';

export function NotFoundContent() {
  const pathname = usePathname();
  const locale = pathname?.split('/')[1] || 'en';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
      <div className="text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Page Not Found</h1>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>
        <LinkButton href={buildRoute(locale, 'home')} variant="positiveOutline">
          Go to Dashboard
        </LinkButton>
      </div>
    </div>
  );
}
