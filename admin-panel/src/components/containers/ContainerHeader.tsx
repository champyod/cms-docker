'use client';

import Link from 'next/link';
import { HelpCircle, Layers, RefreshCw } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';

interface ContainerHeaderProps {
  locale: string;
  loading: boolean;
  actionLoading: string | null;
  onUpAll: () => void;
  onRefresh: () => void;
}

export function ContainerHeader({ locale, loading, actionLoading, onUpAll, onRefresh }: ContainerHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Container Control Center</h1>
          <Link href={`/${locale}/docs#services`} className="p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground" title="View Documentation">
            <HelpCircle className="w-5 h-5" />
          </Link>
        </div>
        <p className="text-muted-foreground mt-1">Manage and monitor Docker services in real-time.</p>
      </div>
      <div className="flex gap-3">
        <Button onClick={onUpAll} disabled={actionLoading === 'compose'}>
          <Layers className="w-4 h-4 mr-2" /> Up All
        </Button>
        <Button variant="secondary" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </Button>
      </div>
    </div>
  );
}
