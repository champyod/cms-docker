'use client';

import { Database, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DatasetModalTabsProps {
  activeTab: 'general' | 'managers';
  hasDataset: boolean;
  onSelectTab: (tab: 'general' | 'managers') => void;
}

export function DatasetModalTabs({ activeTab, hasDataset, onSelectTab }: DatasetModalTabsProps): React.JSX.Element {
  return (
    <>
      <button
        onClick={() => onSelectTab('general')}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors max-sm:flex-1 max-sm:justify-center max-sm:rounded-md max-sm:border max-sm:border-border',
          activeTab === 'general'
            ? 'bg-primary/10 text-primary ring-1 ring-ring/50'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Database className="w-4 h-4" />
        General
      </button>
      <button
        onClick={() => onSelectTab('managers')}
        disabled={!hasDataset}
        title={!hasDataset ? 'Save dataset first' : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors max-sm:flex-1 max-sm:justify-center max-sm:rounded-md max-sm:border max-sm:border-border',
          activeTab === 'managers'
            ? 'bg-primary/10 text-primary ring-1 ring-ring/50'
            : !hasDataset
              ? 'cursor-not-allowed text-muted-foreground opacity-50'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Terminal className="w-4 h-4" />
        Managers
      </button>
    </>
  );
}
