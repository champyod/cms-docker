'use client';

import { useEffect } from 'react';
import { useEnvConfigDocuments, EnvConfigDocuments } from './useEnvConfigDocuments';
import { useRestartAnalysis, RestartAnalysis } from './useRestartAnalysis';
import { useEnvConfigPersistence, EnvConfigPersistence } from './useEnvConfigPersistence';

export interface EnvConfigController extends EnvConfigDocuments, RestartAnalysis, EnvConfigPersistence {}

export function useEnvConfig(): EnvConfigController {
  const documents = useEnvConfigDocuments();
  const analysis = useRestartAnalysis(documents.data, documents.originalData);
  const persistence = useEnvConfigPersistence({
    data: documents.data,
    setOriginalData: documents.setOriginalData,
    setSaving: documents.setSaving,
    requiredRestarts: analysis.requiredRestarts,
    clearRequiredRestarts: analysis.clearRequiredRestarts,
  });

  useEffect(() => {
    void documents.loadData();
  }, []);

  return { ...documents, ...analysis, ...persistence };
}
