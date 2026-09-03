'use client';

import { useSyncExternalStore, type CSSProperties } from 'react';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { getAppliedTheme, subscribeToTheme, type ThemePreference } from '@/lib/theme';

const SERVER_SNAPSHOT = (): ThemePreference | null => null;

const Toaster = ({ theme, ...props }: ToasterProps) => {
  const appliedTheme = useSyncExternalStore(subscribeToTheme, getAppliedTheme, SERVER_SNAPSHOT);

  return (
    <Sonner
      theme={theme ?? appliedTheme ?? 'system'}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
