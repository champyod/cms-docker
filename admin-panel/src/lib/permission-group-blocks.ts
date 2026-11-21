// Capability blocks the seeded groups are composed from: each key is named once
// here, and a group names blocks instead of repeating another group's key list.

const STANDARD_VERBS: readonly string[] = ['list', 'create', 'read', 'update', 'delete'];

/** Signing in to this panel; held by every group that works in the UI. */
export const ADMIN_LOGIN = 'admin:login';

/** `${module}:${verb}` for the five standard verbs, minus any verb in `omitVerbs`. */
export function crud(moduleName: string, omitVerbs: readonly string[] = []): string[] {
  return STANDARD_VERBS.filter((verb) => !omitVerbs.includes(verb)).map(
    (verb) => `${moduleName}:${verb}`,
  );
}

/** The `list` + `read` pair every read block is built from. */
export function reads(moduleName: string): string[] {
  return [`${moduleName}:list`, `${moduleName}:read`];
}

/** Concatenates parts in order, dropping any key an earlier part already named. */
export function compose(...parts: readonly (string | readonly string[])[]): string[] {
  const keys = new Set<string>();
  for (const part of parts) {
    if (typeof part === 'string') {
      keys.add(part);
      continue;
    }
    for (const key of part) keys.add(key);
  }
  return [...keys];
}

/** Clarifications an operator may list, read and answer. */
export const QUESTION_ACCESS: readonly string[] = ['question:list', 'question:read', 'question:answer'];

/** Messages an operator may send: sent rows are immutable, so no update or delete. */
export const MESSAGE_ACCESS: readonly string[] = compose(
  crud('message', ['update', 'delete']),
  'message:send',
);

/** Notices an operator may write and publish on the board. */
export const ANNOUNCEMENT_ACCESS: readonly string[] = compose(
  crud('announcement'),
  'announcement:publish',
);

/** Clarifications, messages and notices, as the messaging groups hold them. */
export const MESSAGING_ACCESS: readonly string[] = compose(
  MESSAGE_ACCESS,
  ANNOUNCEMENT_ACCESS,
  QUESTION_ACCESS,
  'question:ignore',
);

/** The board a viewer-level group reads: contests, tasks, submissions, people. */
export const PUBLIC_READS: readonly string[] = compose(
  reads('contest'),
  reads('task'),
  reads('submission'),
  'submissionresult:read',
  reads('attachment'),
  reads('ranking'),
  reads('user'),
  reads('team'),
  reads('participation'),
  'announcement:list',
  'announcement:read',
);

/** Lockout counters: resetting one is not the standing exemption. */
export const LOCKOUT_READS: readonly string[] = ['lockout:read', 'lockout:unlock'];

/** The security surface: WAF, blocked addresses, lockouts and certificates. */
export const SECURITY_ACCESS: readonly string[] = compose(
  'security:read',
  'waf:read',
  'waf:config',
  'waf:control',
  'ban:read',
  'ban:unban',
  LOCKOUT_READS,
  'lockout:exempt',
  'tls:read',
  'tls:renew',
  'patching:read',
  'patching:waive',
);

/** Submission review: the reads plus the verbs that reprocess a submission. */
export const SUBMISSION_REVIEW: readonly string[] = compose(
  reads('submission'),
  'submission:rejudge',
  'submission:download',
  'submission:recompute',
);

/** Evaluation rows the triage groups list, read and delete. */
export const EVALUATION_TRIAGE: readonly string[] = ['evaluation:list', 'evaluation:read', 'evaluation:delete'];

/** Uploaded artifacts the triage groups read: files, tokens and user-test runs. */
export const SUBMISSION_ARTIFACTS: readonly string[] = compose(
  reads('file'),
  reads('token'),
  reads('usertest'),
);

/** Ranking controls beyond the read: what the board shows and how it scores. */
export const RANKING_CONTROL: readonly string[] = ['ranking:appearance', 'ranking:override'];
