'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Loading } from '@/components/core/Loading';
import { PageContent, PageHeader, Stack } from '@/components/core/Layout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';

type RankingSnapshot = {
  contests: Record<string, { name: string }>;
  tasks: Record<string, { contest: string }>;
  teams: Record<string, { name: string }>;
  users: Record<string, { f_name: string; l_name: string; team: string | null }>;
  scores: Record<string, Record<string, number>>;
};

type RankRow = {
  rank: number;
  userId: string;
  firstName: string;
  lastName: string;
  team: string;
  totalScore: number;
  solved: number;
};

export function RankingClient() {
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [snapshot, setSnapshot] = useState<RankingSnapshot | null>(null);

  const rows = useMemo(() => {
    if (!snapshot) return [] as RankRow[];

    const taskKeys = Object.keys(snapshot.tasks);
    const computedRows = Object.entries(snapshot.users).map(([userId, user]) => {
      const userScores = snapshot.scores[userId] || {};
      const totalScore = taskKeys.reduce((sum, taskId) => sum + Number(userScores[taskId] || 0), 0);
      const solved = taskKeys.filter(taskId => Number(userScores[taskId] || 0) > 0).length;
      const teamName = user.team ? (snapshot.teams[user.team]?.name || user.team) : '-';

      return {
        rank: 0,
        userId,
        firstName: user.f_name,
        lastName: user.l_name,
        team: teamName,
        totalScore,
        solved,
      };
    });

    computedRows.sort((left, right) => {
      if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
      const lastNameCompare = left.lastName.localeCompare(right.lastName);
      if (lastNameCompare !== 0) return lastNameCompare;
      const firstNameCompare = left.firstName.localeCompare(right.firstName);
      if (firstNameCompare !== 0) return firstNameCompare;
      return left.userId.localeCompare(right.userId);
    });

    let currentRank = 1;
    let tieCount = 0;
    let previousScore: number | null = null;

    return computedRows.map((row, index) => {
      if (previousScore === null) {
        previousScore = row.totalScore;
      } else if (row.totalScore === previousScore) {
        tieCount += 1;
      } else {
        currentRank = index + 1;
        tieCount = 0;
        previousScore = row.totalScore;
      }

      return {
        ...row,
        rank: currentRank,
      };
    });
  }, [snapshot]);

  const requestRankingApi = async (
    path: string,
    init: RequestInit | undefined,
    fallbackError: string
  ): Promise<Record<string, unknown>> => {
    const options: RequestInit = { ...(init ?? {}) };
    if (!options.method || options.method === 'GET') {
      options.cache = 'no-store';
    }

    const res = await fetch(`/api/ranking${path}`, options);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || fallbackError);
    }
    return data;
  };

  const runWithLoading = async (
    setLoading: (value: boolean) => void,
    action: () => Promise<void>
  ): Promise<void> => {
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
      await requestRankingApi(
        '/auth',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl, username, password }),
        },
        'Failed to connect ranking'
      );
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

  const fetchSnapshot = () =>
    runWithLoading(setLoadingSnapshot, async () => {
      const data = await requestRankingApi('/snapshot', undefined, 'Failed to fetch ranking snapshot');
      setSnapshot(data.snapshot as RankingSnapshot);
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

      <Card>
        <Stack direction="col" gap={4}>
          <Input
            label="Ranking Base URL"
            value={baseUrl}
            onChange={event => setBaseUrl(event.target.value)}
            placeholder="http://100.114.35.41:8890"
            disabled={connected || loadingSession}
          />
          <Stack direction="row" gap={4} className="w-full">
            <Input
              label="Username"
              value={username}
              onChange={event => setUsername(event.target.value)}
              placeholder="rank"
              disabled={connected || loadingSession}
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="••••••••"
              disabled={connected || loadingSession}
            />
          </Stack>
          <Stack direction="row" gap={3} align="center">
            <Button onClick={connect} loading={loadingSession} disabled={connected || !baseUrl || !username || !password}>
              Connect
            </Button>
            <span className="text-sm text-slate-400">
              Status: <span className={connected ? 'text-emerald-400' : 'text-amber-400'}>{connected ? 'Connected' : 'Disconnected'}</span>
            </span>
          </Stack>
          {errorMessage && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {errorMessage}
            </div>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack direction="col" gap={4}>
          <h2 className="text-xl font-semibold text-white">Scoreboard</h2>
          {loadingSnapshot && <Loading text="Loading ranking snapshot..." />}
          {!loadingSnapshot && rows.length === 0 && (
            <div className="text-sm text-slate-400">No ranking data loaded yet.</div>
          )}
          {!loadingSnapshot && rows.length > 0 && (
            <Table outerClassName="overflow-x-auto" className="w-max table-auto">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead>First Name</TableHead>
                  <TableHead>Last Name</TableHead>
                  <TableHead className="w-40">Team</TableHead>
                  <TableHead className="w-16 text-right">Solved</TableHead>
                  <TableHead className="w-40 text-right">Total Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.userId}>
                    <TableCell className="font-mono">{row.rank}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{row.firstName}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{row.lastName}</TableCell>
                    <TableCell className="text-sm font-mono">{row.team}</TableCell>
                    <TableCell className="text-right font-mono">{row.solved}</TableCell>
                    <TableCell className="text-right font-mono">{row.totalScore.toFixed(2).replace(/\.00$/, '')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Stack>
      </Card>
    </PageContent>
  );
}
