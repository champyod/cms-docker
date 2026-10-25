/**
 * The one rule for a restart's justification, shared by the dialog that asks and the action that runs.
 *
 * Why a module: the action refuses a blank reason, and the dialog refuses one before submitting. Two
 * copies of "is this reason long enough" drift, and the drift is invisible until a restart lands in the
 * audit log with an empty explanation.
 */

/** Enough for a sentence and a half, short enough to stay readable in the audit table. */
export const MAX_RESTART_REASON_CHARS = 500;

export type RestartJustification =
  | { readonly ok: true; readonly reason: string }
  | { readonly ok: false; readonly error: string };

export function normalizeRestartReason(raw: string): RestartJustification {
  const reason = raw.trim().slice(0, MAX_RESTART_REASON_CHARS);
  if (reason.length === 0) {
    return { ok: false, error: 'A reason is required to restart services.' };
  }
  return { ok: true, reason };
}
