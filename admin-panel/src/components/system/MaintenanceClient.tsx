'use client';

import { Save } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { PageSurface } from '@/components/core/PageSurface';
import type { BreadcrumbItem } from '@/lib/navigation/types';
import type { ModulePageCopy } from '@/components/navigation/ModulePageCopy';
import { MaintenanceBackupsCard } from '@/components/system/MaintenanceBackupsCard';
import { MaintenanceNotificationsCard } from '@/components/system/MaintenanceNotificationsCard';
import { useMaintenanceController } from '@/components/system/useMaintenanceController';
import type { Locale } from '@/lib/locales';

export interface MaintenanceClientProps {
  readonly locale: Locale;
  readonly permissionKeys: readonly string[];
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly copy: ModulePageCopy;
}

export function MaintenanceClient({
  locale,
  permissionKeys,
  breadcrumbs,
  copy,
}: MaintenanceClientProps): React.JSX.Element {
  const controller = useMaintenanceController(locale, permissionKeys);
  const { loading, saving, canConfigure, handleSave } = controller;
  if (loading) {
    return (
      <PageSurface
        breadcrumbs={breadcrumbs}
        title={copy.title}
        status={{ kind: 'loading', title: copy.title }}
      >
        {null}
      </PageSurface>
    );
  }

  return (
    <PageSurface
      breadcrumbs={breadcrumbs}
      title={copy.title}
      description={copy.description}
      actions={canConfigure ? (
        <Button variant="positive" onClick={() => void handleSave()} loading={saving}>
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      ) : null}
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <MaintenanceBackupsCard controller={controller} />
        <MaintenanceNotificationsCard controller={controller} />
      </div>
    </PageSurface>
  );
}
