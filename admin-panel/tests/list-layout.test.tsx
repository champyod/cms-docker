import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ListPage } from '@/components/patterns/ListPage';
import { ROW_HEIGHT_CLASS } from '@/components/core/ResponsiveTable';

const crumbs = [{ label: 'Home', href: '/' }];

describe('ListPage', () => {
  it('draws its loading skeleton at the row height the real rows use', () => {
    const html = renderToStaticMarkup(
      <ListPage breadcrumbs={crumbs} title="Contests" loading>
        <table />
      </ListPage>,
    );

    // Taken from the one constant, which carries the density variant: a skeleton with its own height
    // is shorter than the rows it stands in for and ignores the density mode entirely.
    expect(html).toContain(ROW_HEIGHT_CLASS);
    expect(html).toContain('density:h-8');
  });

  it('keeps the same vertical rhythm as every other layout', () => {
    const html = renderToStaticMarkup(
      <ListPage breadcrumbs={crumbs} title="Contests">
        <table />
      </ListPage>,
    );

    expect(html).toContain('space-y-4');
    expect(html).not.toContain('space-y-3');
  });

  it('shows its empty meaning instead of an empty table', () => {
    const html = renderToStaticMarkup(
      <ListPage breadcrumbs={crumbs} title="Contests" empty={<p>No contest yet.</p>}>
        <table>
          <tbody />
        </table>
      </ListPage>,
    );

    expect(html).toContain('No contest yet.');
    expect(html).not.toContain('<table');
  });

  it('reads the state before the rows, and never hides the controls behind it', () => {
    const html = renderToStaticMarkup(
      <ListPage
        breadcrumbs={crumbs}
        title="Patching"
        state={{ tone: 'warning', title: 'Three images are stale' }}
        toolbar={<button type="button">Filter</button>}
      >
        <table />
      </ListPage>,
    );

    expect(html.indexOf('Three images are stale')).toBeLessThan(html.indexOf('Filter'));
    expect(html).toContain('<table');
  });
});
