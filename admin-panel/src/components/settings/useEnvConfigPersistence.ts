'use client';

import { updateConfigTomlValues } from '@/app/actions/configTomlActions';
import { restartServices } from '@/app/actions/services';
import { useDictionary } from '@/hooks/useDictionary';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import { EnvFilesData, collectRelevantUpdates } from './envConfigSections';
import { toast } from 'sonner';

type EnvConfigToasts = Dictionary['toasts']['envConfig'];

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
  toasts: EnvConfigToasts,
): Promise<boolean> {
  const relevantUpdates = collectRelevantUpdates(filename, data);
  const result = await updateConfigTomlValues(relevantUpdates);

  if (!result.success) {
    toast.error(interpolate(toasts.saveFailed, { filename, error: result.error }));
    return false;
  }

  const savedValues: Record<string, string> = {};
  for (const { key, value } of relevantUpdates) {
    savedValues[key] = value;
  }

  setOriginalData(prev => ({
    ...prev,
    [filename]: { ...prev[filename], ...savedValues }
  }));
  return true;
}

async function restartAffectedServices(
  requiredRestarts: string[],
  clearRequiredRestarts: () => void,
  toasts: EnvConfigToasts,
): Promise<void> {
  const restartRes = await restartServices('custom', requiredRestarts);
  if (restartRes.success) {
    toast.success(interpolate(toasts.restarted, { services: requiredRestarts.join(', ') }));
    clearRequiredRestarts();
  } else {
    // Partial success: the file was written, so the operator must hear both facts.
    toast.warning(interpolate(toasts.restartFailed, { error: restartRes.error }));
  }
}

export function useEnvConfigPersistence(deps: PersistenceDeps): EnvConfigPersistence {
  const { data, setOriginalData, setSaving, requiredRestarts, clearRequiredRestarts } = deps;
  const toasts = useDictionary().toasts.envConfig;

  const persistChanges = async (filename: string, shouldRestart: boolean = false): Promise<void> => {
    setSaving(true);
    try {
      const saved = await saveFileUpdates(filename, data, setOriginalData, toasts);
      if (!saved) return;

      if (shouldRestart && requiredRestarts.length > 0) {
        await restartAffectedServices(requiredRestarts, clearRequiredRestarts, toasts);
      } else {
        toast.success(interpolate(toasts.saved, { filename }));
      }
    } catch {
      toast.error(toasts.unexpectedError);
    } finally {
      setSaving(false);
    }
  };

  return { persistChanges };
}
