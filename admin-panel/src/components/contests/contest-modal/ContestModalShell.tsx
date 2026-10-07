'use client';

import type { ComponentType, FormEvent, ReactNode } from 'react';
import { Dialog } from '@/components/core/Dialog';
import { InlineAlert } from '@/components/core/InlineAlert';
import { ModalFooter } from '@/components/core/ModalFooter';
import { ResponsiveModalShell } from '@/components/core/ResponsiveModalShell';
import { Calendar, Shield, Cpu, Clock, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FIELD_TO_TAB_MAP } from './types';
import type { ContestModalTab, ExistingContest } from './types';

const CONTEST_FORM_ID = 'contest-form';

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
        'flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-colors max-sm:w-auto max-sm:flex-1 max-sm:justify-center max-sm:gap-2 max-sm:rounded-full max-sm:px-3 max-sm:py-2 max-sm:text-xs',
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
    <>
      {TABS.map(tab => (
        <TabButton
          key={tab.id}
          tab={tab}
          hasError={tabHasError(validationErrors, tab.id)}
          isActive={activeTab === tab.id}
          onSelect={() => setActiveTab(tab.id)}
        />
      ))}
    </>
  );
}

function ContentBanners({ validationErrors, error }: Pick<ContestModalShellProps, 'validationErrors' | 'error'>) {
  if (validationErrors.size > 0) {
    return (
      <InlineAlert tone="destructive" title={`Please fix the following ${validationErrors.size} errors before saving:`} className="sticky top-0 z-10 mb-6">
        <ul className="list-disc space-y-1 pl-6 text-xs opacity-90">
          {Array.from(validationErrors.entries()).map(([field, msg]) => (
            <li key={field}>{msg}</li>
          ))}
        </ul>
      </InlineAlert>
    );
  }

  if (error) {
    return (
      <InlineAlert tone="destructive" title={error} className="sticky top-0 z-10 mb-6">{null}</InlineAlert>
    );
  }

  return null;
}

function ShellFooter({ contest, loading, onClose }: Pick<ContestModalShellProps, 'contest' | 'loading' | 'onClose'>) {
  // Why the guard: a submit already in flight cannot be recalled, so cancelling
  // through it would close the dialog over an unresolved save.
  const cancel = (): void => {
    if (!loading) onClose();
  };
  return (
    <ModalFooter
      formId={CONTEST_FORM_ID}
      cancelLabel="Cancel"
      confirmLabel={contest ? 'Save Changes' : 'Create Contest'}
      onCancel={cancel}
      onConfirm={() => undefined}
      confirmLoading={loading}
    />
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
    <ResponsiveModalShell
      sidebar={<SidebarTabs validationErrors={validationErrors} activeTab={activeTab} setActiveTab={setActiveTab} />}
    >
      <div className="p-4 sm:p-8">
        <ContentBanners validationErrors={validationErrors} error={error} />

        <form id={CONTEST_FORM_ID} onSubmit={onSubmit} className="space-y-8 pb-20">
          {children}
        </form>
      </div>
    </ResponsiveModalShell>
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
      className="flex max-h-[70vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
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
