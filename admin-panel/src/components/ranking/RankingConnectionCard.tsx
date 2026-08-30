'use client';

import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';

interface Props {
  baseUrl: string;
  username: string;
  password: string;
  connected: boolean;
  loadingSession: boolean;
  errorMessage: string;
  onBaseUrl: (v: string) => void;
  onUsername: (v: string) => void;
  onPassword: (v: string) => void;
  onConnect: () => void;
}

export function RankingConnectionCard({
  baseUrl,
  username,
  password,
  connected,
  loadingSession,
  errorMessage,
  onBaseUrl,
  onUsername,
  onPassword,
  onConnect,
}: Props) {
  return (
    <Card>
      <Stack direction="col" gap={4}>
        <Input label="Ranking Base URL" value={baseUrl} onChange={(e) => onBaseUrl(e.target.value)} placeholder="http://100.114.35.41:8890" disabled={connected || loadingSession} />
        <Stack direction="row" gap={4} className="w-full">
          <Input label="Username" value={username} onChange={(e) => onUsername(e.target.value)} placeholder="rank" disabled={connected || loadingSession} />
          <Input label="Password" type="password" value={password} onChange={(e) => onPassword(e.target.value)} placeholder="••••••••" disabled={connected || loadingSession} />
        </Stack>
        <Stack direction="row" gap={3} align="center">
          <Button onClick={onConnect} loading={loadingSession} disabled={connected || !baseUrl || !username || !password}>
            Connect
          </Button>
          <span className="text-sm text-muted-foreground">
            Status: <span className={connected ? 'text-emerald-400' : 'text-amber-400'}>{connected ? 'Connected' : 'Disconnected'}</span>
          </span>
        </Stack>
        {errorMessage && <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errorMessage}</div>}
      </Stack>
    </Card>
  );
}
