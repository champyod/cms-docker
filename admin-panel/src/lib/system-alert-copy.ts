/**
 * The one place an audit cue becomes words, in the reader's language.
 *
 * WHY this is a module of its own: the bell's list and the operating system's notification show the
 * same event on two surfaces, and a composer kept beside either would leave the other reading the
 * server's English. The server sends the parts (see `AuditCue`), so exactly one function has to turn
 * them into a title and a detail, and both surfaces call it.
 *
 * WHY the verb is not translated: `admin:delete` is an identifier the audit log also shows, and a
 * translated verb would stop the alert matching the row the reader opens. The sentence around it is
 * the dictionary's.
 */
import { interpolate } from '@/lib/interpolate';
import type { AuditCue } from '@/lib/notification-events';

/**
 * The copy an audit cue needs, as it exists in the dictionaries.
 *
 * WHY the shape lives here and not in the dictionary type: a reader of this module has to know what
 * to supply, and both locales are held to it by the test that derives its expectations from them.
 */
export interface AuditCueCopy {
  readonly criticalTitle: string;
  readonly criticalDetail: string;
  readonly failedTitle: string;
  readonly failedDetail: string;
}

/** The title and detail for one cue, in the locale whose dictionary was passed in. */
export function auditCueCopy(cue: AuditCue, copy: AuditCueCopy): { title: string; detail: string } {
  const failed = cue.kind === 'failed';
  return {
    title: interpolate(failed ? copy.failedTitle : copy.criticalTitle, { verb: cue.verb }),
    detail: interpolate(failed ? copy.failedDetail : copy.criticalDetail, {
      actor: cue.actor,
      verb: cue.verb,
      target: cue.target,
    }),
  };
}
