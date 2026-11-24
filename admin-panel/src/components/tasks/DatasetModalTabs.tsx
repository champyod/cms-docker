'use client';

import { Database, Terminal } from 'lucide-react';

import { Button } from '@/components/core/Button';

interface DatasetModalTabsProps {
  activeTab: 'general' | 'managers';
  hasDataset: boolean;
  onSelectTab: (tab: 'general' | 'managers') => void;
}

export function DatasetModalTabs({ activeTab, hasDataset, onSelectTab }: DatasetModalTabsProps): React.JSX.Element {
  return (
    <>
      <Button
        variant={activeTab === 'general' ? 'secondary' : 'ghost'}
        size="sm"
        icon={Database}
        aria-pressed={activeTab === 'general'}
        onClick={() => onSelectTab('general')}
        className="w-full justify-start max-sm:flex-1 max-sm:justify-center max-sm:rounded-md max-sm:border max-sm:border-border"
      >
        General
      </Button>
      <Button
        variant={activeTab === 'managers' ? 'secondary' : 'ghost'}
        size="sm"
        icon={Terminal}
        aria-pressed={activeTab === 'managers'}
        disabled={!hasDataset}
        title={!hasDataset ? 'Save dataset first' : undefined}
        onClick={() => onSelectTab('managers')}
        className="w-full justify-start max-sm:flex-1 max-sm:justify-center max-sm:rounded-md max-sm:border max-sm:border-border"
      >
        Managers
      </Button>
    </>
  );
}
