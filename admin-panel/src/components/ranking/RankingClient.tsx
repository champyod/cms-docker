'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/core/Button';
import { PageSurface } from '@/components/core/PageSurface';
import { Stack } from '@/components/core/Layout';
import { toast } from 'sonner';

import { BrandingCard } from './BrandingCard';
import { RankingConnectionCard } from './RankingConnectionCard';
import { RankingScoreboard } from './RankingScoreboard';
import { useRankingRows, type RankingSnapshot } from './useRankingRows';
import { useDictionary } from '@/hooks/useDictionary';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { BreadcrumbItem } from '@/lib/navigation/types';
import type { ModulePageCopy } from '@/components/navigation/ModulePageCopy';

export interface RankingClientProps {
  readonly permissionKeys: readonly string[];
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly copy: ModulePageCopy;
}

export function RankingClient({ permissionKeys, breadcrumbs, copy }: RankingClientProps): React.JSX.Element {
  const dict = useDictionary();
  const toastCopy = dict.toasts.ranking;
  // Why memoized: the key list is stable for the session, so rebuilding the Set on
  // every render only repeats work the two gates below then probe.
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  // Why these keys: the snapshot route enforces ranking:snapshot while the
  // auth/logo routes enforce ranking:update, so each control mirrors its route.
  const canSnapshot = hasEffectivePermission(effective, 'ranking:snapshot');
  const canManage = hasEffectivePermission(effective, 'ranking:update');
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('rank');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [snapshot, setSnapshot] = useState<RankingSnapshot | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [brandingError, setBrandingError] = useState<string | undefined>(undefined);

  const rows = useRankingRows(snapshot);

  const requestRankingApi = useCallback(async (path: string, init: RequestInit | undefined, fallbackError: string): Promise<Record<string, unknown>> => {
    const options: RequestInit = { ...(init ?? {}) };
    if (!options.method || options.method === 'GET') options.cache = 'no-store';
    const res = await fetch(`/api/ranking${path}`, options);
    const data = await res.json() as { success: boolean; error?: string } & Record<string, unknown>;
    if (!res.ok || !data.success) throw new Error(data.error || fallbackError);
    return data;
  }, []);

  const runWithLoading = useCallback(async (setLoading: (value: boolean) => void, action: () => Promise<void>): Promise<void> => {
    setLoading(true);
    setErrorMessage('');
    try {
      await action();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSnapshot = () =>
    runWithLoading(setLoadingSnapshot, async () => {
      const data = await requestRankingApi('/snapshot', undefined, toastCopy.snapshotFailed);
      setSnapshot(data.snapshot as RankingSnapshot);
    });

  const loadSession = useCallback(() =>
    runWithLoading(setLoadingSession, async () => {
      const data = await requestRankingApi('/auth', undefined, toastCopy.sessionFailed);
      if (data.connected) {
        setConnected(true);
        setBaseUrl((data.baseUrl as string) || '');
        setUsername((data.username as string) || '');
      }
    }),
    [runWithLoading, requestRankingApi, toastCopy],
  );

  const connect = () =>
    runWithLoading(setLoadingSession, async () => {
      await requestRankingApi('/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl, username, password }) }, toastCopy.connectFailed);
      setConnected(true);
      setPassword('');
      await fetchSnapshot();
    });

  const disconnect = () =>
    runWithLoading(setLoadingSession, async () => {
      await requestRankingApi('/auth', { method: 'DELETE' }, toastCopy.disconnectFailed);
      setConnected(false);
      setSnapshot(null);
      setPassword('');
    });

  const buildLogoUrl = useCallback(() => `/api/ranking/logo?ts=${Date.now()}`, []);

  const fetchLogo = useCallback(async () => {
    const url = buildLogoUrl();
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.startsWith('image/')) {
        setLogoUrl(url);
        return;
      }
      const data = (await res.json()) as { success: boolean; exists?: boolean };
      if (data.exists === false) setLogoUrl('');
      else setLogoUrl(url);
    } catch {
      setLogoUrl('');
    }
  }, [buildLogoUrl]);

  const handleLogoUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setBrandingError(undefined);
      try {
        const formData = new FormData();
        formData.append('logo', file);
        const res = await fetch('/api/ranking/logo', { method: 'POST', body: formData });
        const data = (await res.json()) as { success: boolean; error?: string };
        if (!res.ok || !data.success) throw new Error(data.error ?? toastCopy.uploadFailedFallback);
        setLogoUrl(buildLogoUrl());
        toast.success(toastCopy.logoUpdatedTitle, { description: toastCopy.logoUpdatedDescription });
      } catch (error) {
        const message = (error as Error).message;
        setBrandingError(message);
        toast.error(toastCopy.uploadFailedTitle, { description: message });
      } finally {
        setUploading(false);
      }
    },
    [buildLogoUrl, toastCopy],
  );

  useEffect(() => {
    queueMicrotask(() => void loadSession());
  }, [loadSession]);

  useEffect(() => {
    void fetchLogo();
  }, [fetchLogo]);

  return (
    <PageSurface
      breadcrumbs={breadcrumbs}
      title={copy.title}
      description={copy.description}
      actions={
        <Stack direction="row" gap={2}>
          {canSnapshot && (
            <Button variant="secondary" onClick={fetchSnapshot} loading={loadingSnapshot} disabled={!connected}>
              {dict.ranking.refreshSnapshot}
            </Button>
          )}
          {canManage && (
            <Button variant="negative" onClick={disconnect} loading={loadingSession} disabled={!connected}>
              {dict.ranking.disconnect}
            </Button>
          )}
        </Stack>
      }
    >
      <BrandingCard previewUrl={logoUrl} loading={uploading} onUpload={handleLogoUpload} error={brandingError} readOnly={!canManage} />
      <RankingConnectionCard baseUrl={baseUrl} username={username} password={password} connected={connected} loadingSession={loadingSession} errorMessage={errorMessage} onBaseUrl={setBaseUrl} onUsername={setUsername} onPassword={setPassword} onConnect={connect} canManage={canManage} />
      <RankingScoreboard rows={rows} loadingSnapshot={loadingSnapshot} />
    </PageSurface>
  );
}
