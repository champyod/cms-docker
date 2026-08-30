'use client';

import { useState } from 'react';
import { readEnvFile } from '@/app/actions/env';
import {
  CONFIG_SECTIONS,
  EnvFilesData,
  deepCopyEnvData,
  updateFileValue
} from './envConfigSections';

async function fetchAllEnvConfigs(): Promise<EnvFilesData> {
  const result: EnvFilesData = {};

  for (const section of CONFIG_SECTIONS) {
    if (result[section.filename]) continue;
    const res = await readEnvFile(section.filename);
    // Failed reads surface as an empty config instead of blocking the view
    result[section.filename] = res.success && res.config ? res.config : {};
  }

  return result;
}

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

  const loadData = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const next = await fetchAllEnvConfigs();
      setData(next);
      setOriginalData(deepCopyEnvData(next));
    } catch {
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (filename: string, key: string, value: string): void =>
    setData(prev => updateFileValue(prev, filename, key, value));

  return { data, originalData, loading, saving, error, loadData, handleChange, setSaving, setOriginalData };
}
