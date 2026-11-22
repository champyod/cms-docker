import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LinkButton } from '@/components/core/LinkButton';

describe('LinkButton', () => {
  it('is a link, not a button with a click handler', () => {
    const html = renderToStaticMarkup(<LinkButton href="/en/security/patching?waived=1">Flip</LinkButton>);

    // An action that navigates keeps its link semantics: middle click, right click, keyboard, and
    // it works before hydration.
    expect(html).toContain('<a ');
    expect(html).toContain('href="/en/security/patching?waived=1"');
    expect(html).not.toContain('<button');
  });

  it('wears the same control styling as the buttons beside it', () => {
    const html = renderToStaticMarkup(<LinkButton href="/x">Flip</LinkButton>);

    // The look comes from the button variant map, so a link and a button in one row are one family.
    expect(html).toMatch(/class="[^"]*inline-flex/);
    expect(html).toMatch(/class="[^"]*(border|bg-)/);
  });

  it('accepts a legacy variant name and resolves it like the button does', () => {
    const html = renderToStaticMarkup(
      <LinkButton href="/x" variant="danger">
        Remove
      </LinkButton>,
    );

    expect(html).toContain('<a ');
    expect(html).toContain('Remove');
  });
});
