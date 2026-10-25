/** The one rule for a restart's justification: the dialog refuses a blank one, the action enforces it. */

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
