'use client';

import { useCallback, useState } from 'react';
import { MobileBottomBar } from '@/components/layout/MobileBottomBar';
import { FullScreenNavOverlay } from '@/components/layout/FullScreenNavOverlay';
interface MobileNavProps {
  locale: string;
  permissionKeys: readonly string[];
}

export function MobileNav({ locale, permissionKeys }: MobileNavProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const handleToggle = useCallback((): void => setOpen((prev) => !prev), []);
  const handleClose = useCallback((): void => setOpen(false), []);
  return (
    <>
      <MobileBottomBar locale={locale} permissionKeys={permissionKeys} open={open} onToggle={handleToggle} />
      <FullScreenNavOverlay locale={locale} permissionKeys={permissionKeys} open={open} onClose={handleClose} />
    </>
  );
}
