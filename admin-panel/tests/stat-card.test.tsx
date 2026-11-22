import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StatCard } from '@/components/core/StatCard';
import { StatGrid } from '@/components/core/StatGrid';
import { formatCount, formatCountOrText } from '@/lib/format-number';

describe('formatCount', () => {
  it('groups a count the way the reader writes numbers', () => {
    expect(formatCount(1204, 'en')).toBe('1,204');
    expect(formatCount(1204, 'th')).toBe('1,204');
  });

  it('prints text and non-finite values without pretending to format them', () => {
    expect(formatCountOrText('3/3', 'en')).toBe('3/3');
    expect(formatCount(Number.NaN)).toBe('NaN');
  });

  it('survives a locale the runtime does not know', () => {
    expect(formatCount(1204, 'not-a-locale')).toBe('1,204');
  });
});

describe('StatCard', () => {
  it('pairs the label with the value as a definition, not as three loose lines', () => {
    const html = renderToStaticMarkup(<StatCard label="Total users" value={1204} reference="300 enrolled" />);

    expect(html).toContain('<dl');
    expect(html).toContain('<dt');
    expect(html).toContain('Total users');
    // The value is a definition of the term above it, so it is a dd and not a span.
    expect(html).toMatch(/<dd[^>]*>1,204<\/dd>/);
  });

  it('sizes the value below the page title, so a metric never outranks the heading', () => {
    const html = renderToStaticMarkup(<StatCard label="Total users" value={1204} />);

    // The value sits on the ladder's fifth step; the page title is the sixth.
    expect(html).toContain('text-lg');
    expect(html).not.toContain('text-xl');
  });

  it('does not uppercase the label, because Thai cannot shout with capitals', () => {
    const html = renderToStaticMarkup(<StatCard label="ผู้ใช้ทั้งหมด" value={3} />);

    expect(html).not.toContain('uppercase');
  });

  it('formats a count in the locale it was given', () => {
    expect(renderToStaticMarkup(<StatCard label="Users" value={1204} locale="en" />)).toContain('1,204');
    expect(renderToStaticMarkup(<StatCard label="Users" value="1,204" />)).toContain('1,204');
  });
});

describe('StatGrid', () => {
  it('announces the metrics as one set rather than a run of cards', () => {
    const html = renderToStaticMarkup(
      <StatGrid
        totals={[
          { label: 'Users', value: 3 },
          { label: 'Contests', value: 2 },
        ]}
      />,
    );

    expect(html).toContain('<ul');
    expect([...html.matchAll(/<li/g)]).toHaveLength(2);
  });

  it('decides the columns once, so two pages cannot disagree about a metric', () => {
    const html = renderToStaticMarkup(<StatGrid totals={[{ label: 'Users', value: 3 }]} />);

    expect(html).toContain('sm:grid-cols-2');
    expect(html).toContain('xl:grid-cols-3');
  });
});
