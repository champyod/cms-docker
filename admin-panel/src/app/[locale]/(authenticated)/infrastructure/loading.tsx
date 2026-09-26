'use client';

import { PageSurface } from '@/components/core/PageSurface';
import { useDictionary } from '@/hooks/useDictionary';

export default function InfrastructureLoading(): React.JSX.Element {
  const dict = useDictionary();
  const group = dict['navigation']['groups']['infrastructure'];
  return (
    <PageSurface
      breadcrumbs={[{ label: group }]}
      title={group}
      status={{ kind: 'loading', title: dict['navigation']['states']['loading'] }}
    >
      {null}
    </PageSurface>
  );
}
