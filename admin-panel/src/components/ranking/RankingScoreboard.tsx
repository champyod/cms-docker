'use client';

import { Card } from '@/components/core/Card';
import { Loading } from '@/components/core/Loading';
import { Stack } from '@/components/core/Layout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import type { RankRow } from './useRankingRows';

interface Props {
  rows: RankRow[];
  loadingSnapshot: boolean;
}

export function RankingScoreboard({ rows, loadingSnapshot }: Props) {
  return (
    <Card>
      <Stack direction="col" gap={4}>
        <h2 className="text-xl font-semibold text-white">Scoreboard</h2>
        {loadingSnapshot && <Loading text="Loading ranking snapshot..." />}
        {!loadingSnapshot && rows.length === 0 && <div className="text-sm text-slate-400">No ranking data loaded yet.</div>}
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
              {rows.map((row) => (
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
  );
}
