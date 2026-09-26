'use client';

import { Stack } from '@/components/core/Layout';
import { ContestsSection } from '@/components/docs/sections/ContestsSection';
import { DocsNavigationGrid } from '@/components/docs/sections/DocsNavigationGrid';
import { ServicesSection } from '@/components/docs/sections/ServicesSection';
import { SubmissionsSection } from '@/components/docs/sections/SubmissionsSection';
import { TasksSection } from '@/components/docs/sections/TasksSection';
import { UsersSection } from '@/components/docs/sections/UsersSection';

export function DocsContent(): React.JSX.Element {
  return (
    <Stack gap={12} className="mx-auto max-w-5xl">
      <DocsNavigationGrid />
      <ContestsSection />
      <UsersSection />
      <TasksSection />
      <SubmissionsSection />
      <ServicesSection />
    </Stack>
  );
}
