import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';

const DIRECT_LABEL_CASES = [
  { labelKey: 'navigation.groups.direct', en: 'Direct', th: 'การแข่งขัน' },
  { labelKey: 'navigation.home.label', en: 'Dashboard', th: 'แดชบอร์ด' },
  { labelKey: 'navigation.contests.list.label', en: 'Contests', th: 'การแข่งขัน' },
  { labelKey: 'navigation.tasks.list.label', en: 'Tasks', th: 'งาน' },
] as const;

function resolveGeneratedLabel(dictionary: unknown, labelKey: string): string {
  let current: unknown = dictionary;
  for (const segment of labelKey.split('.')) {
    if (typeof current !== 'object' || current === null) {
      throw new Error(`Missing dictionary key: ${labelKey}`);
    }
    current = Reflect.get(current, segment);
  }
  if (typeof current !== 'string') throw new Error(`Dictionary key is not a label: ${labelKey}`);
  return current;
}

describe('direct bilingual navigation labels', () => {
  it('resolves all four generated keys in English and Thai', () => {
    for (const label of DIRECT_LABEL_CASES) {
      const english = resolveGeneratedLabel(en, label.labelKey);
      const thai = resolveGeneratedLabel(th, label.labelKey);
      expect(english).toBe(label.en);
      expect(thai).toBe(label.th);
      expect(english.trim()).not.toBe('');
      expect(thai.trim()).not.toBe('');
    }
  });
});
