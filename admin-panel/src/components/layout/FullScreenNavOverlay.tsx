'use client';

import { Fragment, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { useDictionary } from '@/hooks/useDictionary';
import {
  buildShellSections,
  type ShellNavSection,
} from '@/components/navigation/shell-nav';
import { SidebarNavItem, SectionLabel } from '@/components/layout/SidebarNavItem';
import { SignOutLink } from '@/components/layout/Sidebar';

interface FullScreenNavOverlayProps {
  locale: string;
  permissionKeys: readonly string[];
  open: boolean;
  onClose: () => void;
}

const ROW_CLASSES = 'flex h-11 min-h-11 items-center';

function OverlayHeader({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow-sm">C</div>
        <span className="truncate font-display font-semibold tracking-wide">CMS Admin</span>
      </div>
      <Button variant="secondary" size="sm" iconOnly tooltip="Close" onClick={onClose} className="size-11">
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}

function OverlayGroup({ section, onClose }: { section: ShellNavSection; onClose: () => void }): React.JSX.Element {
  return (
    <Fragment>
      {section.label && <SectionLabel label={section.label} collapsed={false} />}
      {section.items.map((item) => (
        <SidebarNavItem key={item.id} item={item} collapsed={false} density="touch" onClick={onClose} />
      ))}
    </Fragment>
  );
}

function OverlayBody({ locale, permissionKeys, onClose }: Omit<FullScreenNavOverlayProps, 'open'>): React.JSX.Element {
  const dictionary = useDictionary();
  const sections = useMemo(
    () => buildShellSections(new Set(permissionKeys), 'mobile-more', locale, dictionary),
    [permissionKeys, locale, dictionary],
  );
  return (
    <div className="flex-1 overflow-y-auto space-y-1 p-4 scrollbar-thin">
      {sections.map((section) => (
        <OverlayGroup key={section.groupId ?? 'ungrouped'} section={section} onClose={onClose} />
      ))}
      <div className={ROW_CLASSES}>
        <SignOutLink locale={locale} collapsed={false} density="touch" />
      </div>
    </div>
  );
}

export function FullScreenNavOverlay({ locale, permissionKeys, open, onClose }: FullScreenNavOverlayProps): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
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
