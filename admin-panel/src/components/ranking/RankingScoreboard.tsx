'use client';

import { Trophy } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { SkeletonTable } from '@/components/core/Skeleton';
import { EmptyState } from '@/components/core/EmptyState';
import type { RankRow } from './useRankingRows';

interface Props {
  rows: RankRow[];
  loadingSnapshot: boolean;
}

export function RankingScoreboard({ rows, loadingSnapshot }: Props) {
  return (
    <Card>
      <Stack direction="col" gap={4}>
        <h2 className="text-xl font-semibold text-foreground">Scoreboard</h2>
        {loadingSnapshot && <SkeletonTable rows={8} cols={6} />}
        {!loadingSnapshot && rows.length === 0 && <EmptyState icon={Trophy} title="No ranking data loaded yet." />}
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
                  <TableCell className="max-w-48 truncate">{row.firstName}</TableCell>
                  <TableCell className="max-w-48 truncate">{row.lastName}</TableCell>
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
