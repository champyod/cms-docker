'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/core/Button';
import { PageContent, PageHeader, Stack } from '@/components/core/Layout';
import { RankingConnectionCard } from './RankingConnectionCard';
import { RankingScoreboard } from './RankingScoreboard';
import { useRankingRows, type RankingSnapshot } from './useRankingRows';

export function RankingClient() {
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [snapshot, setSnapshot] = useState<RankingSnapshot | null>(null);

  const rows = useRankingRows(snapshot);

  const requestRankingApi = async (path: string, init: RequestInit | undefined, fallbackError: string): Promise<Record<string, unknown>> => {
    const options: RequestInit = { ...(init ?? {}) };
    if (!options.method || options.method === 'GET') options.cache = 'no-store';
    const res = await fetch(`/api/ranking${path}`, options);
    const data = await res.json() as { success: boolean; error?: string } & Record<string, unknown>;
    if (!res.ok || !data.success) throw new Error(data.error || fallbackError);
    return data;
  };

  const runWithLoading = async (setLoading: (value: boolean) => void, action: () => Promise<void>): Promise<void> => {
    setLoading(true);
    setErrorMessage('');
    try {
      await action();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSnapshot = () =>
    runWithLoading(setLoadingSnapshot, async () => {
      const data = await requestRankingApi('/snapshot', undefined, 'Failed to fetch ranking snapshot');
      setSnapshot(data.snapshot as RankingSnapshot);
    });

  const loadSession = () =>
    runWithLoading(setLoadingSession, async () => {
      const data = await requestRankingApi('/auth', undefined, 'Failed to load ranking session');
      if (data.connected) {
        setConnected(true);
        setBaseUrl((data.baseUrl as string) || '');
        setUsername((data.username as string) || '');
      }
    });

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

  useEffect(() => {
    void loadSession();
  }, []);

  return (
    <PageContent>
      <PageHeader
        title="Secure Ranking"
        description="Server-side proxy for ranking data with protected credential session."
        actions={
          <Stack direction="row" gap={2}>
            <Button variant="secondary" onClick={fetchSnapshot} loading={loadingSnapshot} disabled={!connected}>
              Refresh Snapshot
            </Button>
            <Button variant="danger" onClick={disconnect} loading={loadingSession} disabled={!connected}>
              Disconnect
            </Button>
          </Stack>
        }
      />
      <RankingConnectionCard baseUrl={baseUrl} username={username} password={password} connected={connected} loadingSession={loadingSession} errorMessage={errorMessage} onBaseUrl={setBaseUrl} onUsername={setUsername} onPassword={setPassword} onConnect={connect} />
      <RankingScoreboard rows={rows} loadingSnapshot={loadingSnapshot} />
    </PageContent>
  );
}
