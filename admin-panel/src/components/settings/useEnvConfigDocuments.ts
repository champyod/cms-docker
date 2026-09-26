'use client';

import { useCallback, useState } from 'react';
import { readConfigTomlValues } from '@/app/actions/configTomlActions';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
import {
  deepCopyEnvData,
  configTomlKeys,
  updateFileValue,
  type EnvFilesData,
} from './envConfigSections';

export interface EnvConfigDocuments {
  data: EnvFilesData;
  originalData: EnvFilesData;
  loading: boolean;
  saving: boolean;
  error: string;
  loadData: () => Promise<void>;
  handleChange: (filename: string, key: string, value: string) => void;
  setSaving: (saving: boolean) => void;
  setOriginalData: (updater: (prev: EnvFilesData) => EnvFilesData) => void;
}

export function useEnvConfigDocuments(): EnvConfigDocuments {
  const [originalData, setOriginalData] = useState<EnvFilesData>({});
  const [data, setData] = useState<EnvFilesData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reads config.toml rather than the .env it generates: the generated file lags the
  // source until the next sync, so showing it would hide the value just saved here.
  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const result = await readConfigTomlValues(configTomlKeys());
      if (!result.success) {
        setError('Failed to load configuration');
        return;
      }
      const next: EnvFilesData = { [CONFIG_TOML_FILE]: result.values };
      setData(next);
      setOriginalData(deepCopyEnvData(next));
    } catch {
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (filename: string, key: string, value: string): void =>
    setData(prev => updateFileValue(prev, filename, key, value));

  return { data, originalData, loading, saving, error, loadData, handleChange, setSaving, setOriginalData };
}
