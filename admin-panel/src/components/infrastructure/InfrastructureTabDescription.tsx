'use client';

import type { ReactNode } from 'react';

import { useActiveTabDescription } from '@/components/navigation/ModuleTabShell';
import type { RouteTab } from '@/lib/navigation/types';

interface InfrastructureTabDescriptionProps {
  readonly tabs: readonly RouteTab[];
  readonly descriptions: Readonly<Record<string, ReactNode>>;
}

/** The line under the module title naming what the tab the reader is on is for. */
export function InfrastructureTabDescription({
  tabs,
  descriptions,
}: InfrastructureTabDescriptionProps): React.JSX.Element | null {
  const description = useActiveTabDescription(tabs, descriptions);
  if (description === undefined) return null;
  return <>{description}</>;
}