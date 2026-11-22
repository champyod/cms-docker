import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DetailPage } from '@/components/patterns/DetailPage';

const crumbs = [{ label: 'Home', href: '/' }];

describe('DetailPage', () => {
  it('formats a numeric fact once, in the layout, instead of trusting every page to do it', () => {
    const html = renderToStaticMarkup(
      <DetailPage
        breadcrumbs={crumbs}
        title="TLS"
        locale="en"
        facts={[
          { term: 'Lineages', value: 1204 },
          { term: 'Certbot', value: 'running' },
        ]}
      />,
    );

    expect(html).toContain('1,204');
    expect(html).toContain('running');
  });

  it('reads each fact as a term and a definition, in a definition list', () => {
    const html = renderToStaticMarkup(
      <DetailPage breadcrumbs={crumbs} title="TLS" facts={[{ term: 'Lineages', value: 3 }]} />,
    );

    expect(html).toContain('<dl');
    expect(html).toContain('<dt');
    expect(html).toMatch(/<dd[^>]*>3<\/dd>/);
  });

  it('does not shout a term in a way Thai cannot', () => {
    const html = renderToStaticMarkup(
      <DetailPage breadcrumbs={crumbs} title="TLS" facts={[{ term: 'จำนวนใบรับรอง', value: 3 }]} />,
    );

    expect(html).not.toContain('uppercase');
  });

  it('places the record state above the facts, and the sections after them', () => {
    const html = renderToStaticMarkup(
      <DetailPage
        breadcrumbs={crumbs}
        title="TLS"
        state={<p>Proxy is not running</p>}
        facts={[{ term: 'Certbot', value: 'stopped' }]}
      >
        <p>Lineages</p>
      </DetailPage>,
    );

    expect(html.indexOf('Proxy is not running')).toBeLessThan(html.indexOf('Certbot'));
    expect(html.indexOf('Certbot')).toBeLessThan(html.indexOf('Lineages'));
  });
});
