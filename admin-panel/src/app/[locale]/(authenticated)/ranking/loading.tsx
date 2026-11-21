'use client';

import { PageSurface } from '@/components/core/PageSurface';
import { useDictionary } from '@/hooks/useDictionary';
import { listBreadcrumbs, localeFromPathname } from '@/lib/navigation/breadcrumbs';
import { usePathname } from 'next/navigation';

export default function RankingLoading(): React.JSX.Element {
  const dict = useDictionary();
  const group = dict['navigation']['groups']['ranking'];
  return (
    <PageSurface
      breadcrumbs={listBreadcrumbs(localeFromPathname(usePathname()), 'ranking', null, dict)}
      title={group}
      status={{ kind: 'loading', title: dict['navigation']['states']['loading'] }}
    >
      {null}
    </PageSurface>
  );
}
