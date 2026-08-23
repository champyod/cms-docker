'use client';

import type { ComponentType, FormEvent, ReactNode } from 'react';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Portal } from '@/components/core/Portal';
import { X, Loader2, Calendar, Shield, Cpu, Clock, Settings, FileText } from 'lucide-react';
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

function ModalHeader({ contest, onClose }: Pick<ContestModalShellProps, 'contest' | 'onClose'>) {
  return (
    <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
      <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
        <Settings className="w-6 h-6 text-indigo-400" />
        {contest ? 'Edit Contest' : 'Create New Contest'}
      </h2>
      <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors">
        <X className="w-6 h-6" />
      </button>
    </div>
  );
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
        "w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all",
        isActive
          ? "bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/50"
          : "text-neutral-400 hover:bg-white/5 hover:text-white"
      )}
    >
      <div className="flex items-center gap-3">
        <tab.icon className="w-4 h-4" />
        {tab.label}
      </div>
      {hasError && (
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
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
    <div className="w-64 bg-black/20 border-r border-white/10 p-4 space-y-2 overflow-y-auto">
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
      <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex flex-col gap-2 sticky top-0 z-10 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="font-bold">Please fix the following {validationErrors.size} errors before saving:</span>
        </div>
        <ul className="list-disc pl-6 space-y-1 text-xs opacity-90">
          {Array.from(validationErrors.entries()).map(([field, msg]) => (
            <li key={field}>{msg}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-3 sticky top-0 z-10 backdrop-blur-md">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        {error}
      </div>
    );
  }

  return null;
}

function ShellFooter({ contest, loading, onClose }: Pick<ContestModalShellProps, 'contest' | 'loading' | 'onClose'>) {
  return (
    <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3 z-20">
      <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={loading}
          className="px-6 text-neutral-400 hover:text-white"
        >
          Cancel
        </Button>
        <Button
        type="submit"
        form="contest-form"
          variant="primary"
        className="bg-indigo-600 hover:bg-indigo-500 text-white min-w-[140px] shadow-lg shadow-indigo-500/20 rounded-xl"
          disabled={loading}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : (contest ? 'Save Changes' : 'Create Contest')}
        </Button>
    </div>
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
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar Tabs */}
      <SidebarTabs validationErrors={validationErrors} activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto p-8 relative">
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
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-md p-4">
        <Card className="w-full max-w-4xl h-[90vh] flex flex-col p-0 relative animate-in fade-in zoom-in-95 duration-200 glass-card border-white/10 shadow-2xl overflow-hidden">
          {/* Header */}
          <ModalHeader contest={contest} onClose={onClose} />
          {/* Tabs & Content */}
          <ShellBody
            validationErrors={validationErrors} error={error} activeTab={activeTab}
            setActiveTab={setActiveTab} onSubmit={onSubmit}
          >
            {children}
          </ShellBody>
          {/* Footer */}
          <ShellFooter contest={contest} loading={loading} onClose={onClose} />
        </Card>
      </div>
    </Portal>
  );
}
