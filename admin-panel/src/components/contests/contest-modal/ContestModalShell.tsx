'use client';

import type { ComponentType, FormEvent, ReactNode } from 'react';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { Calendar, Shield, Cpu, Clock, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FIELD_TO_TAB_MAP } from './types';
import type { ContestModalTab, ExistingContest } from './types';

interface ContestModalShellProps {
  contest?: ExistingContest | null;
  onClose: () => void;
  loading: boolean;
  error: string;
  validationErrors: Map<string, string>;
  activeTab: ContestModalTab;
  setActiveTab: (tab: ContestModalTab) => void;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}

interface TabDefinition {
  id: ContestModalTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const TABS: TabDefinition[] = [
  { id: 'general', label: 'General', icon: FileText },
  { id: 'access', label: 'Access Control', icon: Shield },
  { id: 'tokens', label: 'Tokens', icon: Cpu },
  { id: 'limits', label: 'Limits', icon: Clock },
  { id: 'analysis', label: 'Analysis Mode', icon: Calendar },
];

function tabHasError(validationErrors: Map<string, string>, tabId: string): boolean {
  return Array.from(validationErrors.entries()).some(([field]) => FIELD_TO_TAB_MAP[field] === tabId);
}

function TabButton({
  tab,
  hasError,
  isActive,
  onSelect,
}: {
  tab: TabDefinition;
  hasError: boolean;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-colors',
        isActive
          ? 'bg-primary/10 text-primary ring-1 ring-ring/50'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <div className="flex items-center gap-3">
        <tab.icon className="h-4 w-4" />
        {tab.label}
      </div>
      {hasError && (
        <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
      )}
    </button>
  );
}

function SidebarTabs({
  validationErrors,
  activeTab,
  setActiveTab,
}: Pick<ContestModalShellProps, 'validationErrors' | 'activeTab' | 'setActiveTab'>) {
  return (
    <div className="w-64 shrink-0 space-y-2 overflow-y-auto border-r border-border bg-muted/20 p-4">
      {TABS.map(tab => (
        <TabButton
          key={tab.id}
          tab={tab}
          hasError={tabHasError(validationErrors, tab.id)}
          isActive={activeTab === tab.id}
          onSelect={() => setActiveTab(tab.id)}
        />
      ))}
    </div>
  );
}

function ContentBanners({ validationErrors, error }: Pick<ContestModalShellProps, 'validationErrors' | 'error'>) {
  if (validationErrors.size > 0) {
    return (
      <div className="sticky top-0 z-10 mb-6 flex flex-col gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
          <span className="font-bold">Please fix the following {validationErrors.size} errors before saving:</span>
        </div>
        <ul className="list-disc space-y-1 pl-6 text-xs opacity-90">
          {Array.from(validationErrors.entries()).map(([field, msg]) => (
            <li key={field}>{msg}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sticky top-0 z-10 mb-6 flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive backdrop-blur-md">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
        {error}
      </div>
    );
  }

  return null;
}

function ShellFooter({ contest, loading, onClose }: Pick<ContestModalShellProps, 'contest' | 'loading' | 'onClose'>) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={onClose}
        disabled={loading}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        form="contest-form"
        variant="positive"
        loading={loading}
        disabled={loading}
        className="min-w-[140px]"
      >
        {contest ? 'Save Changes' : 'Create Contest'}
      </Button>
    </>
  );
}

function ShellBody({
  validationErrors,
  error,
  activeTab,
  setActiveTab,
  onSubmit,
  children,
}: Pick<ContestModalShellProps, 'validationErrors' | 'error' | 'activeTab' | 'setActiveTab' | 'onSubmit' | 'children'>) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Sidebar Tabs */}
      <SidebarTabs validationErrors={validationErrors} activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Form Content */}
      <div className="relative flex-1 overflow-y-auto p-8">
        <ContentBanners validationErrors={validationErrors} error={error} />

        <form id="contest-form" onSubmit={onSubmit} className="space-y-8 pb-20">
          {children}
        </form>
      </div>
    </div>
  );
}

export function ContestModalShell({
  contest,
  onClose,
  loading,
  error,
  validationErrors,
  activeTab,
  setActiveTab,
  onSubmit,
  children,
}: ContestModalShellProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={contest ? 'Edit Contest' : 'Create New Contest'}
      footer={<ShellFooter contest={contest} loading={loading} onClose={onClose} />}
      className="flex h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
    >
      <ShellBody
        validationErrors={validationErrors} error={error} activeTab={activeTab}
        setActiveTab={setActiveTab} onSubmit={onSubmit}
      >
        {children}
      </ShellBody>
    </Dialog>
  );
}
