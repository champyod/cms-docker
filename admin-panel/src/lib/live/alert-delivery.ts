'use client';

import { notifyDevice } from '@/lib/live/device-notifications';

/** One system event, as the notification service holds it. */
export interface SystemEventCue {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * The one surface an event was given beyond the panel's own record.
 *
 * `record` means the event exists only where the panel keeps it — the bell's list, or the header's
 * question dot — and nothing outside the panel was raised for it.
 */
export type AlertSurface = 'record' | 'notification';

/**
 * Which events this tab already posted a device notification for.
 *
 * Why the claim is shared storage and not a ref: every open tab holds its own connection to the alert
 * stream, so one arrival reaches all of them and an unclaimed event becomes one notification per tab.
 * The first tab to claim an id posts it; its siblings record the event and stay silent.
 */
const CLAIM_KEY = 'cms-panel:system-alert-claims';

/** How long a claim is remembered; a frame id is stable, so this only bounds the store. */
const CLAIM_TTL_MS = 5 * 60_000;

/** How many claims one tab keeps; the oldest fall off first. */
const CLAIM_LIMIT = 50;

interface Claim {
  readonly id: string;
  readonly at: number;
}

function readClaims(now: number): Claim[] {
  try {
    const raw = window.localStorage.getItem(CLAIM_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Claim =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Claim).id === 'string' &&
        typeof (entry as Claim).at === 'number' &&
        now - (entry as Claim).at < CLAIM_TTL_MS,
    );
  } catch {
    // Unreadable storage is treated as empty rather than as a claim: an alert is never dropped to
    // keep a store consistent.
    return [];
  }
}

/**
 * Records this tab as the one that posts the event, or answers false when another tab already has.
 *
 * Why a claim and not a leader election: the only thing the tabs must agree on is "one notification
 * per event", and one small read-modify-write per event is enough for that — a tab that loses the race
 * posts a duplicate, and the next event is claimed again.
 */
function claimDeviceNotification(id: string, now: number): boolean {
  if (typeof window === 'undefined') return true;
  const claims = readClaims(now);
  if (claims.some((claim) => claim.id === id)) return false;
  try {
    window.localStorage.setItem(CLAIM_KEY, JSON.stringify([...claims, { id, at: now }].slice(-CLAIM_LIMIT)));
    return true;
  } catch {
    // Storage refused (a private window, a full quota): this tab cannot tell the others, so it must
    // not swallow the alert on their behalf.
    return true;
  }
}

/**
 * Whether this tab is on screen right now.
 *
 * Why `visibilityState` and not focus: a window that is visible but not focused — beside an editor,
 * on a second monitor — is still being watched, and a focus check would alert for alerts the operator
 * can see.
 */
export function isPanelOnScreen(): boolean {
  return typeof document === 'undefined' || document.hidden !== true;
}

/**
 * Gives one system event its single surface.
 *
 * Why exactly one cue: the panel already records every event — the bell's list for the alert stream,
 * the header's question dot for the question stream — so a toast or a device notification beside that
 * record is the same arrival said twice. This used to be three surfaces at once (list, toast, OS
 * notification); one event is now one cue.
 *
 * Why the surface depends on the operator: on screen, the badge that changes is enough and anything
 * more is noise; hidden, there is no badge to notice, so exactly one OS notification carries it —
 * claimed across tabs, so N open tabs never mean N notifications for one event.
 *
 * Why the caller keeps the record: this decides only the cue outside the panel. The list, the count
 * and the dedup belong to the service that received the frame, whatever this answers.
 */
export function deliverSystemEvent(cue: SystemEventCue): AlertSurface {
  if (isPanelOnScreen()) return 'record';
  if (!claimDeviceNotification(cue.id, Date.now())) return 'record';
  notifyDevice(cue.title, cue.detail);
  return 'notification';
}
