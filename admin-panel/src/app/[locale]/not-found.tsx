'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function LocaleNotFound() {
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950">
      <div className="text-center space-y-6">
        <div className="space-y-2">
          <p className="text-8xl font-bold text-white/10 select-none">404</p>
          <h1 className="text-2xl font-semibold text-white">Page Not Found</h1>
          <p className="text-white/50 text-sm max-w-xs mx-auto">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-400 text-sm font-medium transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
