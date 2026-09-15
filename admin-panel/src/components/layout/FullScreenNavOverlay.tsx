'use client';

import { Fragment, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { NAV_SECTIONS, DOCUMENTATION_ITEM, buildVisibility, type SidebarPermissions } from '@/components/layout/sidebar-nav';
import { SidebarNavItem, SectionLabel } from '@/components/layout/SidebarNavItem';
import { SignOutLink } from '@/components/layout/Sidebar';

interface FullScreenNavOverlayProps {
  locale: string;
  permissions?: SidebarPermissions;
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

function OverlayBody({ locale, permissions, onClose }: { locale: string; permissions?: SidebarPermissions; onClose: () => void }): React.JSX.Element {
  const visibility = buildVisibility(permissions);
  return (
    <div className="flex-1 overflow-y-auto space-y-1 p-4 scrollbar-thin">
      {NAV_SECTIONS.map((section) => {
        if (section.superadminOnly && !visibility.superadmin) return null;
        return (
          <Fragment key={section.label ?? 'top'}>
            {section.label !== null && <SectionLabel label={section.label} collapsed={false} />}
            {section.items
              .filter((item) => item.isVisible(visibility))
              .map((item) => (
                <SidebarNavItem key={item.label} item={item} locale={locale} collapsed={false} onClick={onClose} />
              ))}
          </Fragment>
        );
      })}
      <SidebarNavItem item={DOCUMENTATION_ITEM} locale={locale} collapsed={false} onClick={onClose} />
      <SignOutLink locale={locale} collapsed={false} />
    </div>
  );
}

export function FullScreenNavOverlay({ locale, permissions, open, onClose }: FullScreenNavOverlayProps): React.JSX.Element | null {
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
      <OverlayBody locale={locale} permissions={permissions} onClose={onClose} />
    </div>
  );
}
