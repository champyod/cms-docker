'use client';

import { PageSurface } from '@/components/core/PageSurface';
import { useDictionary } from '@/hooks/useDictionary';

export default function SystemNotFound(): React.JSX.Element {
  const dict = useDictionary();
  const group = dict['navigation']['groups']['system'];
  const notFoundTitle = dict['navigation']['states']['notFound'];
  return (
    <PageSurface
      breadcrumbs={[{ label: group }]}
      title={notFoundTitle}
      status={{ kind: 'not-found', title: notFoundTitle }}
    >
      {null}
    </PageSurface>
  );
}
