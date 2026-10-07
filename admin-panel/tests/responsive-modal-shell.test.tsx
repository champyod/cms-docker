import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResponsiveModalShell } from '@/components/core/ResponsiveModalShell';

describe('ResponsiveModalShell', () => {
  it('renders sidebar and content', () => {
    const html = renderToStaticMarkup(
      <ResponsiveModalShell sidebar={<nav>Tabs</nav>}>
        <section>Body</section>
      </ResponsiveModalShell>
    );
    expect(html).toContain('Tabs');
    expect(html).toContain('Body');
  });

  it('defaults to the established sm:w-64 sidebar width', () => {
    const html = renderToStaticMarkup(
      <ResponsiveModalShell sidebar={<nav>Tabs</nav>}>
        <section>Body</section>
      </ResponsiveModalShell>
    );
    expect(html).toContain('sm:w-64');
  });

  it('honours a custom sidebarWidthClass', () => {
    const html = renderToStaticMarkup(
      <ResponsiveModalShell sidebar={<nav>Tabs</nav>} sidebarWidthClass="sm:w-48">
        <section>Body</section>
      </ResponsiveModalShell>
    );
    expect(html).toContain('sm:w-48');
    expect(html).not.toContain('sm:w-64');
  });

  it('carries the single-source responsive pattern', () => {
    const html = renderToStaticMarkup(
      <ResponsiveModalShell sidebar={<nav>Tabs</nav>}>
        <section>Body</section>
      </ResponsiveModalShell>
    );
    expect(html).toContain('sm:flex-row');
    expect(html).toContain('max-sm:flex-row');
    expect(html).toContain('sm:border-r');
  });
});
