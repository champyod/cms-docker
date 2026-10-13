import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LogoMark, LogoWordmark } from '@/components/brand/Logo';

describe('LogoMark', () => {
  it('renders the mark with an accessible name', () => {
    const html = renderToStaticMarkup(<LogoMark className="size-8" />);

    expect(html).toContain('aria-label="CCYod CMS Docker"');
    expect(html).toContain('size-8');
    expect(html).toContain('viewBox="0 0 128 128"');
  });
});

describe('LogoWordmark', () => {
  it('leads with the CCYod name and keeps the CMS Docker descriptor', () => {
    const html = renderToStaticMarkup(<LogoWordmark />);

    expect(html).toContain('CC');
    expect(html).toContain('Yod');
    expect(html).toContain('CMS Docker');
  });
});
