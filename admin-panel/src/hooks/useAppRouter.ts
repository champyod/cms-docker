'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';

type NavigateOptions = Parameters<ReturnType<typeof useRouter>['push']>[1];

export interface AppRouter {
  push: (href: string, options?: NavigateOptions) => void;
  replace: (href: string, options?: NavigateOptions) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  prefetch: (href: string) => void;
}

// App router with container-owned scrolling: the shell scrolls
// #main-scroll-container (see ScrollReset), never the window, so every
// navigation defaults to scroll:false unless the caller opts back in.
export function useAppRouter(): AppRouter {
  const router = useRouter();
  return useMemo(
    () => ({
      push: (href: string, options?: NavigateOptions): void => {
        router.push(href, { scroll: false, ...options });
      },
      replace: (href: string, options?: NavigateOptions): void => {
        router.replace(href, { scroll: false, ...options });
      },
      back: (): void => {
        router.back();
      },
      forward: (): void => {
        router.forward();
      },
      refresh: (): void => {
        router.refresh();
      },
      prefetch: (href: string): void => {
        router.prefetch(href);
      },
    }),
    [router],
  );
}
