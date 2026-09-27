'use client';

import { Button } from '@/components/core/Button';
import { PageSurface } from '@/components/core/PageSurface';
import { useDictionary } from '@/hooks/useDictionary';
import { listBreadcrumbs, localeFromPathname } from '@/lib/navigation/breadcrumbs';
import { usePathname } from 'next/navigation';

export default function InfrastructureError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  const dict = useDictionary();
  const group = dict['navigation']['groups']['infrastructure'];
  return (
    <PageSurface
      breadcrumbs={listBreadcrumbs(localeFromPathname(usePathname()), 'infrastructure', null, dict)}
      title={group}
      status={{
        kind: 'error',
        title: `${group} ${dict['navigation']['states']['error']}`,
        action: <Button onClick={reset}>{dict['navigation']['states']['retry']}</Button>,
      }}
    >
      {null}
    </PageSurface>
  );
}
