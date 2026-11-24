import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BoardPage, boardSection } from '@/components/patterns/BoardPage';

const crumbs = [{ label: 'Home', href: '/' }];

describe('BoardPage', () => {
  it('renders each section with its own title, and its own meaning of empty', () => {
    const html = renderToStaticMarkup(
      <BoardPage
        breadcrumbs={crumbs}
        title="Security"
        sections={[
          { key: 'bans', title: 'Banned addresses', description: 'Blocked at the proxy', rows: <span>1.2.3.4</span> },
          { key: 'lockouts', title: 'Open lockouts', isEmpty: true, empty: <span>No lockouts</span> },
        ]}
      />
    );

    expect(html).toContain('Banned addresses');
    expect(html).toContain('Blocked at the proxy');
    expect(html).toContain('1.2.3.4');
    expect(html).toContain('No lockouts');
  });

  it('chooses exactly one body, so a section cannot pass rows and empty together', () => {
    const html = renderToStaticMarkup(
      <BoardPage
        breadcrumbs={crumbs}
        title="Security"
        sections={[
          { key: 'empty', title: 'No rows', ...boardSection(true, <span>empty body</span>, <span>row body</span>) },
          { key: 'rows', title: 'Has rows', ...boardSection(false, <span>unused empty</span>, <span>used row</span>) },
        ]}
      />
    );

    expect(html).toContain('empty body');
    expect(html).not.toContain('row body');
    expect(html).toContain('used row');
    expect(html).not.toContain('unused empty');
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

    // The count is a badge beside the heading, so a reader navigating by headings hears the word alone.
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
    // No sections is legitimate only when the state says why.
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
