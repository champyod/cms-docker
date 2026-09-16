'use client';

import { Fragment, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { entriesByGroup, visibleEntries } from '@/lib/nav-registry';
import { SidebarNavItem, SectionLabel } from '@/components/layout/SidebarNavItem';
import { SignOutLink } from '@/components/layout/Sidebar';

interface FullScreenNavOverlayProps {
  locale: string;
  permissionKeys: readonly string[];
  open: boolean;
  onClose: () => void;
}

function OverlayHeader({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow-sm">C</div>
        <span className="truncate font-display font-semibold tracking-wide">CMS Admin</span>
      </div>
      <Button variant="secondary" size="sm" iconOnly tooltip="Close" onClick={onClose} className="size-11">
        <X className="size-4" />
      </Button>
    </div>
  );
}

function OverlayBody({ locale, permissionKeys, onClose }: { locale: string; permissionKeys: readonly string[]; onClose: () => void }): React.JSX.Element {
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const sections = useMemo(() => entriesByGroup(effective, 'sidebar'), [effective]);
  const docsEntry = useMemo(() => visibleEntries(effective, 'sidebar').find((entry) => entry.path === '/docs'), [effective]);
  return (
    <div className="flex-1 overflow-y-auto space-y-1 p-4 scrollbar-thin">
      {sections.map((section) => (
        <Fragment key={section.group}>
          {section.group !== 'general' && <SectionLabel label={section.group === 'contest' ? 'Contest' : 'Infrastructure'} collapsed={false} />}
          {section.entries
            .filter((entry) => entry.path !== '/docs')
            .map((entry) => (
              <SidebarNavItem key={entry.path} entry={entry} locale={locale} collapsed={false} onClick={onClose} />
            ))}
        </Fragment>
      ))}
      {docsEntry && <SidebarNavItem entry={docsEntry} locale={locale} collapsed={false} onClick={onClose} />}
      <SignOutLink locale={locale} collapsed={false} />
    </div>
  );
}

export function FullScreenNavOverlay({ locale, permissionKeys, open, onClose }: FullScreenNavOverlayProps): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
      <OverlayHeader onClose={onClose} />
      <OverlayBody locale={locale} permissionKeys={permissionKeys} onClose={onClose} />
    </div>
  );
}
