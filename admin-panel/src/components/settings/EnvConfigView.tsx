'use client';

import { Loader } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEnvConfig } from './useEnvConfig';
import { CONFIG_SECTIONS } from './envConfigSections';
import { EnvSectionCard } from './EnvSectionCard';
import { UnsavedRestartBanner } from './UnsavedRestartBanner';
import { ManualServiceControlCard, MaintenanceUpdatesCard } from './MaintenanceControls';

export function EnvConfigView(): ReactElement {
  const config = useEnvConfig();

  if (config.loading) {
    return <div className="text-white flex items-center gap-2"><Loader className="animate-spin" /> Loading configuration...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Load Error */}
      {config.error && (
        <div className="p-4 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg">
          {config.error}
        </div>
      )}

      {/* Pending Restarts Warning */}
      {config.requiredRestarts.length > 0 && <UnsavedRestartBanner services={config.requiredRestarts} />}

      {/* Config Sections */}
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
  );
}
