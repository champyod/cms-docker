'use server'

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';

const MAX_LANE_NAME_LENGTH = 64;

interface ActionResult {
  success: boolean;
  error?: string;
}

function validateLaneInput(submissionId: number, lane: string): string | null {
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return 'Invalid submission id';
  }
  const trimmed = lane.trim();
  if (trimmed.length === 0) {
    return 'Lane must not be empty';
  }
  if (trimmed.length > MAX_LANE_NAME_LENGTH) {
    return `Lane must be at most ${MAX_LANE_NAME_LENGTH} characters`;
  }
  return null;
}

export async function assignEvaluationLane(submissionId: number, lane: string): Promise<ActionResult> {
  await ensurePermission('evaluation:lane_assign');

  const validationError = validateLaneInput(submissionId, lane);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const submission = await prisma.submissions.findUnique({
      where: { id: submissionId },
      select: { id: true },
    });
    if (!submission) {
      return { success: false, error: 'Submission not found' };
    }

    // Why: no dedicated lane column exists, so the assignment is recorded in the
    // tamper-evident audit log until lane persistence lands.
    await recordAudit({
      verb: 'evaluation:lane_assign',
      entity: 'submission',
      entityId: String(submissionId),
      afterValues: { lane: lane.trim(), assignedAt: new Date().toISOString() },
      result: 'success',
    });
    revalidatePath('/[locale]/submissions');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function moveEvaluationLane(submissionId: number, lane: string): Promise<ActionResult> {
  await ensurePermission('evaluation:lane_move');

  const validationError = validateLaneInput(submissionId, lane);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const submission = await prisma.submissions.findUnique({
      where: { id: submissionId },
      select: { id: true },
    });
    if (!submission) {
      return { success: false, error: 'Submission not found' };
    }

    // Why: no dedicated lane column exists, so the move is recorded in the
    // tamper-evident audit log until lane persistence lands.
    await recordAudit({
      verb: 'evaluation:lane_move',
      entity: 'submission',
      entityId: String(submissionId),
      afterValues: { lane: lane.trim(), movedAt: new Date().toISOString() },
      result: 'success',
    });
    revalidatePath('/[locale]/submissions');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function setFinalOpen(contestId: number, open: boolean): Promise<ActionResult> {
  await ensurePermission('contest:update');

  if (!Number.isInteger(contestId) || contestId <= 0) {
    return { success: false, error: 'Invalid contest id' };
  }

  try {
    const contest = await prisma.contests.findUnique({
      where: { id: contestId },
      select: { id: true },
    });
    if (!contest) {
      return { success: false, error: 'Contest not found' };
    }

    // Why raw SQL: the throttle columns are not in the generated client yet,
    // so the typed update cannot set them.
    const stampedAt = open ? new Date() : null;
    await prisma.$executeRaw`
      UPDATE contests
      SET evaluation_final_open = ${open}, evaluation_final_open_at = ${stampedAt}
      WHERE id = ${contestId}
    `;

    await recordAudit({
      verb: 'contest:update',
      entity: 'contest',
      entityId: String(contestId),
      afterValues: { evaluation_final_open: open, openedAt: new Date().toISOString() },
      result: 'success',
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
