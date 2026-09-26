'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/core/Button';
import { PageContent, PageHeader, Stack } from '@/components/core/Layout';
import { toast } from 'sonner';

import { BrandingCard } from './BrandingCard';
import { RankingConnectionCard } from './RankingConnectionCard';
import { RankingScoreboard } from './RankingScoreboard';
import { useRankingRows, type RankingSnapshot } from './useRankingRows';
import { hasEffectivePermission } from '@/lib/permission-engine';

export function RankingClient({ permissionKeys }: { permissionKeys: readonly string[] }) {
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
      const data = await requestRankingApi('/snapshot', undefined, 'Failed to fetch ranking snapshot');
      setSnapshot(data.snapshot as RankingSnapshot);
    });

  const loadSession = useCallback(() =>
    runWithLoading(setLoadingSession, async () => {
      const data = await requestRankingApi('/auth', undefined, 'Failed to load ranking session');
      if (data.connected) {
        setConnected(true);
        setBaseUrl((data.baseUrl as string) || '');
        setUsername((data.username as string) || '');
      }
    }),
    [runWithLoading, requestRankingApi],
  );

  const connect = () =>
    runWithLoading(setLoadingSession, async () => {
      await requestRankingApi('/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl, username, password }) }, 'Failed to connect ranking');
      setConnected(true);
      setPassword('');
      await fetchSnapshot();
    });

  const disconnect = () =>
    runWithLoading(setLoadingSession, async () => {
      await requestRankingApi('/auth', { method: 'DELETE' }, 'Failed to disconnect ranking');
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
        if (!res.ok || !data.success) throw new Error(data.error ?? 'Failed to upload logo');
        const nextUrl = buildLogoUrl();
        setLogoUrl(nextUrl);
        toast.success('Logo updated', { description: 'Ranking logo hot reloaded' });
      } catch (error) {
        const message = (error as Error).message;
        setBrandingError(message);
        toast.error('Upload failed', { description: message });
      } finally {
        setUploading(false);
      }
    },
    [buildLogoUrl],
  );

  useEffect(() => {
    queueMicrotask(() => void loadSession());
  }, [loadSession]);

  useEffect(() => {
    void fetchLogo();
  }, [fetchLogo]);

  return (
    <PageContent>
      <PageHeader
        title="Secure Ranking"
        description="Server-side proxy for ranking data with protected credential session."
        actions={
          <Stack direction="row" gap={2}>
            {canSnapshot && (
              <Button variant="secondary" onClick={fetchSnapshot} loading={loadingSnapshot} disabled={!connected}>
                Refresh Snapshot
              </Button>
            )}
            {canManage && (
              <Button variant="negative" onClick={disconnect} loading={loadingSession} disabled={!connected}>
                Disconnect
              </Button>
            )}
          </Stack>
        }
      />
      <BrandingCard previewUrl={logoUrl} loading={uploading} onUpload={handleLogoUpload} error={brandingError} readOnly={!canManage} />
      <RankingConnectionCard baseUrl={baseUrl} username={username} password={password} connected={connected} loadingSession={loadingSession} errorMessage={errorMessage} onBaseUrl={setBaseUrl} onUsername={setUsername} onPassword={setPassword} onConnect={connect} canManage={canManage} />
      <RankingScoreboard rows={rows} loadingSnapshot={loadingSnapshot} />
    </PageContent>
  );
}
