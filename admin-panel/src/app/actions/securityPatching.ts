'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/app/actions/auth';
import { ensurePermission } from '@/lib/permissions';
import { createWaiver, endWaiver, type WaiverInput, type WaiverWriteResult } from '@/lib/panel-actions/patching-waivers';
import {
  readPatchingPage,
  readPatchingSnapshot,
  type PatchingSnapshot,
} from '@/lib/security/patching-read';
import type { PatchingListState, PatchingQueryInput } from '@/lib/security/patching';

const PATCHING_PAGE_PATH = '/[locale]/security/patching';

export type PatchingActionResult = WaiverWriteResult;

/**
 * The one gate both reads pass through.
 *
 * WHY both keys here and not only in the route descriptor: the descriptor decides whether the page
 * is offered, and this decides whether its data is returned — a caller who reaches an action another
 * way still has to hold the same pair. Two reads now exist (the page's table and the overview's
 * numbers), and they are the same data, so they must not be two gates that can drift apart.
 */
async function requirePatchingRead(): Promise<void> {
  await ensurePermission('security:read');
  await ensurePermission('patching:read');
}

/**
 * The overview cards' and the signal job's read: the four numbers plus the digest.
 *
 * WHY the patching page no longer calls this: its table is paged in SQL, so the page asks for one
 * page (`readPatchingFindingsPage`) instead of the whole feed plus a digest it does not render. The
 * numbers still come from one place, so the two surfaces cannot disagree about them.
 */
export async function readPatchingState(): Promise<PatchingSnapshot> {
  await requirePatchingRead();
  return readPatchingSnapshot();
}

/**
 * One page of the findings table, with the filters, the sort and the page number applied by SQL.
 *
 * WHY the query travels as raw strings: they are what the URL carried, so the validation (unknown
 * filter → 'all', non-integer page → 1, page past the end → the last page) happens once, in
 * `readPatchingQuery`/`clampPatchingPage`, rather than at every call site.
 */
export async function readPatchingFindingsPage(
  input: PatchingQueryInput,
): Promise<PatchingListState> {
  await requirePatchingRead();
  return readPatchingPage(input);
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
