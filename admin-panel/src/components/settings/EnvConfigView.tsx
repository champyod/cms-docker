'use client';

import type { ReactElement } from 'react';
import { InlineAlert } from '@/components/core/InlineAlert';
import { Loading } from '@/components/core/Loading';
import { useEnvConfig } from './useEnvConfig';
import { CONFIG_SECTIONS } from './envConfigSections';
import { EnvSectionCard } from './EnvSectionCard';
import { UnsavedRestartBanner } from './UnsavedRestartBanner';
import { ManualServiceControlCard, MaintenanceUpdatesCard, DeploymentModeNote } from './MaintenanceControls';

// Why no header here: the settings group above this view carries the title, the description and
// the reach of a save, so a second title inside the content would be the same string twice.
export function EnvConfigView(): ReactElement {
  const config = useEnvConfig();

  if (config.loading) {
    return <Loading text="Loading configuration..." />;
  }

  return (
    <div className="space-y-8">
      {/* Above the sections: every restart on this page ('Save & Restart' and the manual buttons
          below) runs the same command, so the mode is stated once for the page. */}
      <DeploymentModeNote />
      {config.error && <InlineAlert tone="destructive" title={config.error} className="mt-8">{null}</InlineAlert>}
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
          databaseProfiles={config.databaseProfiles}
        />
      ))}

      <ManualServiceControlCard />
      <MaintenanceUpdatesCard />
    </div>
  );
}
