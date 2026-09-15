'use client';

import { useCallback, useState } from 'react';
import { MobileBottomBar } from '@/components/layout/MobileBottomBar';
import { FullScreenNavOverlay } from '@/components/layout/FullScreenNavOverlay';
import type { SidebarPermissions } from '@/components/layout/sidebar-nav';

interface MobileNavProps {
  locale: string;
  permissions?: SidebarPermissions;
}

export function MobileNav({ locale, permissions }: MobileNavProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const handleToggle = useCallback((): void => setOpen((prev) => !prev), []);
  const handleClose = useCallback((): void => setOpen(false), []);
  return (
    <>
      <MobileBottomBar locale={locale} permissions={permissions} open={open} onToggle={handleToggle} />
      <FullScreenNavOverlay locale={locale} permissions={permissions} open={open} onClose={handleClose} />
    </>
  );
}
