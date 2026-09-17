'use client';

import type { ReactElement } from 'react';
import { PageContent, PageHeader } from '@/components/core/Layout';
import { Loading } from '@/components/core/Loading';
import { useEnvConfig } from './useEnvConfig';
import { CONFIG_SECTIONS } from './envConfigSections';
import { EnvSectionCard } from './EnvSectionCard';
import { UnsavedRestartBanner } from './UnsavedRestartBanner';
import { ManualServiceControlCard, MaintenanceUpdatesCard, DeploymentModeNote } from './MaintenanceControls';

export function EnvConfigView(): ReactElement {
  const config = useEnvConfig();

  if (config.loading) {
    return <Loading text="Loading configuration..." />;
  }

  return (
    <PageContent>
      <PageHeader
        title="System Settings"
        description="Configure environment files and service restarts."
      />
      {/* Above the sections: every restart on this page ('Save & Restart' and the manual buttons
          below) runs the same command, so the mode is stated once for the page. */}
      <DeploymentModeNote />
      <div className="space-y-8">
        {config.error && (
          <div className="p-4 bg-destructive/10 text-destructive border border-destructive/30 rounded-lg">
            {config.error}
          </div>
        )}
        {config.requiredRestarts.length > 0 && <UnsavedRestartBanner services={config.requiredRestarts} />}
        {CONFIG_SECTIONS.map((section) => (
          <EnvSectionCard
            key={section.title}
            section={section}
            data={config.data}
            originalData={config.originalData}
            saving={config.saving}
            hasPendingRestarts={config.requiredRestarts.length > 0}
            onPersist={(filename, shouldRestart) => config.persistChanges(filename, shouldRestart)}
            onChange={config.handleChange}
          />
        ))}

        <ManualServiceControlCard />
        <MaintenanceUpdatesCard />
      </div>
    </PageContent>
  );
}
