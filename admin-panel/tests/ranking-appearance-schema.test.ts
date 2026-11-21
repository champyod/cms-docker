import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildAppearanceSections } from '@/components/ranking/appearance/appearanceSchema';
import type { Dictionary } from '@/lib/dictionary';

type AppearanceCopy = Dictionary['ranking']['appearance'];

/** The real English copy, so the test fails when a label the schema reads is removed. */
function appearanceCopy(): AppearanceCopy {
  const raw = fs.readFileSync(path.resolve(__dirname, '..', 'src/dictionaries/en.json'), 'utf8');
  const parsed = JSON.parse(raw) as { ranking: { appearance: AppearanceCopy } };
  return parsed.ranking.appearance;
}

function sections(): ReturnType<typeof buildAppearanceSections> {
  return buildAppearanceSections(appearanceCopy());
}

describe('ranking appearance schema', () => {
  const fields = sections().flatMap((section) => section.fields);

  it('declares every editable appearance field, both JSON columns included', () => {
    expect(fields.map((field) => field.name)).toEqual([
      'title',
      'subtitle',
      'organisation',
      'displayName',
      'accessMode',
      'showIdColumn',
      'anonymous',
      'footerText',
      'creditsText',
      'theme',
      'scoreFormat',
      'perspectives',
    ]);
  });

  it('names no contest: the config decides which one the board draws', () => {
    // The field this form used to carry wrote a column the reader ignored, so a select here would
    // be a second place a contest could be named and the wrong one would win.
    expect(fields.map((field) => field.name)).not.toContain('contestId');
  });

  it('gives every field a label and every select its options', () => {
    for (const field of fields) {
      expect(field.label.length).toBeGreaterThan(0);
      if (field.kind === 'select') expect(field.options?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('renders the free-form JSON columns as json controls', () => {
    expect(fields.filter((field) => field.kind === 'json').map((field) => field.name)).toEqual([
      'theme',
      'scoreFormat',
      'perspectives',
    ]);
  });

  it('groups the fields into titled sections', () => {
    const built = sections();
    expect(built.map((section) => section.id)).toEqual(['identity', 'display', 'advanced']);
    for (const section of built) expect(section.title.length).toBeGreaterThan(0);
  });
});
