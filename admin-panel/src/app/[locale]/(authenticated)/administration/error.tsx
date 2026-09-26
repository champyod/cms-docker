'use client';

import { Button } from '@/components/core/Button';
import { PageSurface } from '@/components/core/PageSurface';
import { useDictionary } from '@/hooks/useDictionary';

export default function AdministrationError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  const dict = useDictionary();
  const group = dict['navigation']['groups']['administration'];
  return (
    <PageSurface
      breadcrumbs={[{ label: group }]}
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
