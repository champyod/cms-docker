'use client';

import { updateEnvFile } from '@/app/actions/env';
import { restartServices } from '@/app/actions/services';
import { EnvFilesData, collectRelevantUpdates } from './envConfigSections';

interface PersistenceDeps {
  data: EnvFilesData;
  setOriginalData: (updater: (prev: EnvFilesData) => EnvFilesData) => void;
  setSaving: (saving: boolean) => void;
  requiredRestarts: string[];
  clearRequiredRestarts: () => void;
}

export interface EnvConfigPersistence {
  persistChanges: (filename: string, shouldRestart?: boolean) => Promise<void>;
}

async function saveFileUpdates(
  filename: string,
  data: EnvFilesData,
  setOriginalData: PersistenceDeps['setOriginalData'],
): Promise<boolean> {
  const relevantUpdates = collectRelevantUpdates(filename, data);
  const result = await updateEnvFile(filename, relevantUpdates);

  if (!result.success) {
    alert(`Failed to save ${filename}: ` + result.error);
    return false;
  }

  setOriginalData(prev => ({
    ...prev,
    [filename]: { ...prev[filename], ...relevantUpdates }
  }));
  return true;
}

async function restartAffectedServices(
  requiredRestarts: string[],
  clearRequiredRestarts: () => void,
): Promise<void> {
  const restartRes = await restartServices('custom', requiredRestarts);
  if (restartRes.success) {
    alert(`Saved and restarted: ${requiredRestarts.join(', ')}`);
    clearRequiredRestarts();
  } else {
    alert('Saved, but failed to restart: ' + restartRes.error);
  }
}

export function useEnvConfigPersistence(deps: PersistenceDeps): EnvConfigPersistence {
  const { data, setOriginalData, setSaving, requiredRestarts, clearRequiredRestarts } = deps;

  const persistChanges = async (filename: string, shouldRestart: boolean = false): Promise<void> => {
    setSaving(true);
    try {
      const saved = await saveFileUpdates(filename, data, setOriginalData);
      if (!saved) return;

      if (shouldRestart && requiredRestarts.length > 0) {
        await restartAffectedServices(requiredRestarts, clearRequiredRestarts);
      } else {
        alert(`Saved ${filename} successfully!`);
      }
    } catch {
      alert('An error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  return { persistChanges };
}
