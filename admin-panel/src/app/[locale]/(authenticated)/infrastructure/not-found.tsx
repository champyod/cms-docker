'use client';

import { PageSurface } from '@/components/core/PageSurface';
import { useDictionary } from '@/hooks/useDictionary';
import { listBreadcrumbs, localeFromPathname } from '@/lib/navigation/breadcrumbs';
import { usePathname } from 'next/navigation';

export default function InfrastructureNotFound(): React.JSX.Element {
  const dict = useDictionary();
  const notFoundTitle = dict['navigation']['states']['notFound'];
  return (
    <PageSurface
      breadcrumbs={listBreadcrumbs(localeFromPathname(usePathname()), 'infrastructure', null, dict)}
      title={notFoundTitle}
      status={{ kind: 'not-found', title: notFoundTitle }}
    >
      {null}
    </PageSurface>
  );
}
