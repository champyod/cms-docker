import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import type { AuditCue } from '@/lib/notification-events';
import { auditCueCopy } from '@/lib/system-alert-copy';

// The cues every audit alert can produce: one critical success, one sensitive failure.
const CUES: readonly AuditCue[] = [
  { kind: 'critical', verb: 'admin:delete', actor: 'Ada', target: 'admin #7' },
  { kind: 'failed', verb: 'override:set', actor: 'system', target: 'contest #3' },
];

const LOCALES = [
  { name: 'en', copy: en.systemAlerts.audit },
  { name: 'th', copy: th.systemAlerts.audit },
] as const;

const PLACEHOLDER = /\{\w+\}/;

describe('audit cue copy', () => {
  it('fills every placeholder in both locales', () => {
    // Why derived from the dictionaries rather than from expected strings: a new template that forgets
    // a value fails here instead of reaching an operator as a literal `{target}`.
    for (const locale of LOCALES) {
      for (const cue of CUES) {
        const { title, detail } = auditCueCopy(cue, locale.copy);
        expect(title, locale.name).not.toMatch(PLACEHOLDER);
        expect(detail, locale.name).not.toMatch(PLACEHOLDER);
        expect(detail, locale.name).toContain(cue.actor);
        expect(detail, locale.name).toContain(cue.target);
      }
    }
  });

  it('keeps the verb untranslated, because it is the identifier the audit log shows', () => {
    for (const locale of LOCALES) {
      for (const cue of CUES) {
        const { title, detail } = auditCueCopy(cue, locale.copy);
        expect(title, locale.name).toContain(cue.verb);
        expect(detail, locale.name).toContain(cue.verb);
      }
    }
  });

  it('reads differently in Thai than in English for every cue', () => {
    // Why the inequality: an untranslated template that happened to copy the English would satisfy every
    // other assertion here while leaving a Thai panel in English — the defect this change exists to fix.
    for (const cue of CUES) {
      const english = auditCueCopy(cue, en.systemAlerts.audit);
      const thai = auditCueCopy(cue, th.systemAlerts.audit);
      expect(thai.title).not.toBe(english.title);
      expect(thai.detail).not.toBe(english.detail);
    }
  });

  it('says a failure differently from a success', () => {
    const copy = en.systemAlerts.audit;
    const succeeded = auditCueCopy(CUES[0], copy);
    const failed = auditCueCopy(CUES[1], copy);
    expect(failed.title).not.toBe(succeeded.title);
    expect(failed.detail).not.toBe(succeeded.detail);
  });
});
