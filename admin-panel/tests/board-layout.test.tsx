import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BoardPage } from '@/components/patterns/BoardPage';

const crumbs = [{ label: 'Home', href: '/' }];

describe('BoardPage', () => {
  it('renders each section with its own title, and its own meaning of empty', () => {
    const html = renderToStaticMarkup(
      <BoardPage
        breadcrumbs={crumbs}
        title="Security"
        sections={[
          { key: 'bans', title: 'Banned addresses', description: 'Blocked at the proxy', rows: <span>1.2.3.4</span> },
          { key: 'lockouts', title: 'Open lockouts', empty: <span>No lockouts</span>, rows: <span>never shown</span> },
        ]}
      />
    );

    expect(html).toContain('Banned addresses');
    expect(html).toContain('Blocked at the proxy');
    expect(html).toContain('No lockouts');
    // a section that declares its empty state does not render its rows as well
    expect(html).not.toContain('never shown');
  });

  it('keeps the heading level for every section, so a board does not drift into five layouts', () => {
    const html = renderToStaticMarkup(
      <BoardPage
        breadcrumbs={crumbs}
        title="Security"
        sections={[
          { key: 'a', title: 'One', rows: <span>a</span> },
          { key: 'b', title: 'Two', rows: <span>b</span> },
        ]}
      />
    );

    expect([...html.matchAll(/<h2/g)]).toHaveLength(2);
  });

  it('declares the shell as the header owner when the page sits under a module', () => {
    const html = renderToStaticMarkup(
      <BoardPage breadcrumbs={[]} title="Security" ownsHeader={false} sections={[{ key: 'a', title: 'One', rows: <span>a</span> }]} />
    );

    expect(html).toContain('data-surface-owns-header="shell"');
  });

  it('puts a section count in its own slot, outside the heading name', () => {
    const html = renderToStaticMarkup(
      <BoardPage
        breadcrumbs={crumbs}
        title="Services"
        sections={[{ key: 'services', title: 'Service', count: 12, rows: <span>rows</span> }]}
      />,
    );

    // The heading is the word; the count is a badge beside it, so a reader navigating by headings
    // hears "Service" and not "Service 12".
    expect(html).toMatch(/<h2[^>]*>Service<\/h2>/);
    expect(html).toContain('(12)');
  });

  it('reads freshness as a note, not as a line of content', () => {
    const html = renderToStaticMarkup(
      <BoardPage
        breadcrumbs={crumbs}
        title="Security"
        freshness="read a moment ago"
        sections={[{ key: 'a', title: 'One', rows: <span>a</span> }]}
      />,
    );

    expect(html).toContain('read a moment ago');
    expect(html).toMatch(/text-xs[^>]*>read a moment ago/);
  });

  it('renders its state alone when the thing it is about does not exist yet', () => {
    // A board with no sections is legitimate: the page says why in its state, and the gate fails a
    // board that has neither.
    const html = renderToStaticMarkup(
      <BoardPage
        breadcrumbs={crumbs}
        title="Overrides"
        state={<p>No ranking shard is configured.</p>}
        sections={[]}
      />,
    );

    expect(html).toContain('No ranking shard is configured.');
    expect(html).not.toContain('<h2');
  });
});
