import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CountdownZoneClock } from '@/components/contests/contest-detail/CountdownZoneClock';

describe('CountdownZoneClock', () => {
  const markup = renderToStaticMarkup(
    <CountdownZoneClock now={new Date('2026-01-01T08:07:09Z')} timezone="UTC" />,
  );

  it('renders the hours, minutes and seconds', () => {
    expect(markup).toContain('08:07:09');
  });

  it('gives every numeral its own slot so the row cannot twitch as the seconds tick', () => {
    // Quoted so the -glyphs container class, which shares this prefix, is not counted.
    const glyphs = markup.match(/countdown-zone-clock-glyph"/g) ?? [];
    // Six numerals: hours, minutes and seconds. The colons are deliberately not slotted.
    expect(glyphs).toHaveLength(6);
    expect(markup.match(/countdown-zone-clock-sep/g) ?? []).toHaveLength(2);
  });

  it('names the zone and the full date in the tooltip', () => {
    expect(markup).toContain('title="');
    expect(markup).toContain('(UTC)');
  });
});
