'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/app/actions/auth';
import { ensurePermission } from '@/lib/permissions';
import { createWaiver, endWaiver, type WaiverInput, type WaiverWriteResult } from '@/lib/panel-actions/patching-waivers';
import { readPatchingSnapshot, type PatchingSnapshot } from '@/lib/security/patching-read';

const PATCHING_PAGE_PATH = '/[locale]/security/patching';

export type PatchingActionResult = WaiverWriteResult;

/**
 * The page's and the overview cards' only read entry.
 *
 * WHY both keys here and not only in the route descriptor: the descriptor decides whether
 * the page is offered, and this decides whether its data is returned — a caller who reaches
 * the action another way still has to hold the same pair. The overview calls this same
 * function, so its cards and the digest cannot come from a second query.
 *
 * WHY it returns the digest with the table state: the card, the push channel and the page have to
 * agree on "what is wrong and how bad", and the only way to guarantee that is one read that computes
 * it once (`readPatchingSnapshot`). A caller wanting only the groups ignores `signal`.
 */
export async function readPatchingState(): Promise<PatchingSnapshot> {
  await ensurePermission('security:read');
  await ensurePermission('patching:read');
  return readPatchingSnapshot();
}

export async function createPatchingWaiver(input: WaiverInput): Promise<PatchingActionResult> {
  await ensurePermission('security:read');
  // Why its own key: waiving a finding is an access decision, and the read key that opens
  // the page must not also authorize writing the decision down.
  await ensurePermission('patching:waive');
  const admin = await getCurrentUser();
  if (admin === null) return { success: false, error: 'No administrator session to attribute the waiver to' };
  const result = await createWaiver(admin.id, input);
  if (result.success) revalidatePath(PATCHING_PAGE_PATH, 'page');
  return result;
}

export async function endPatchingWaiver(waiverId: number, reason: string): Promise<PatchingActionResult> {
  await ensurePermission('security:read');
  await ensurePermission('patching:waive');
  const admin = await getCurrentUser();
  if (admin === null) return { success: false, error: 'No administrator session to attribute the waiver to' };
  const result = await endWaiver(admin.id, waiverId, reason);
  if (result.success) revalidatePath(PATCHING_PAGE_PATH, 'page');
  return result;
}
