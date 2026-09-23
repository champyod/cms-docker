import { notFound } from 'next/navigation';

import { getLaneBoard } from '@/app/actions/evaluationLanes';
import { LaneBoard } from '@/components/submissions/LaneBoard';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { checkPermission, getPermissions } from '@/lib/permissions';

export default async function SubmissionLanesPage() {
  // Why evaluation:list: the board is built from lane audit rows, and
  // getLaneBoard enforces that key — gating here matches the list-page
  // convention (404 so forbidden looks like a missing page).
  const hasPermission = await checkPermission('evaluation:list', false);
  if (!hasPermission) {
    notFound();
  }

  const board = await getLaneBoard();
  const permissionKeys = [...(await getPermissions())];

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">Evaluation lanes</Text>
        <Text variant="muted">Drag submissions between lanes or move them with a reason.</Text>
      </Stack>

      <LaneBoard board={board} permissionKeys={permissionKeys} />
    </Stack>
  );
}
