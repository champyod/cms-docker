import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DetailPage } from '@/components/patterns/DetailPage';
import { SettingsPage } from '@/components/patterns/SettingsPage';

/**
 * The layouts are contracts, not decoration: each test asserts the thing that makes the layout
 * worth having - the strip instead of prose, the summary above the fields, the scope line.
 */
const crumbs = [{ label: 'Home', href: '/' }];

describe('DetailPage', () => {
  it('renders the record as term/value pairs, not a sentence', () => {
    const html = renderToStaticMarkup(
      <DetailPage
        breadcrumbs={crumbs}
        title="Contest 9"
        facts={[
          { term: 'Window', value: '14:00–16:00' },
          { term: 'State', value: 'Scoring' },
        ]}
      >
        <div>participants</div>
      </DetailPage>
    );

    expect(html).toContain('<dl');
    expect(html).toContain('<dt');
    expect(html).toContain('<dd');
    expect(html).toContain('participants');
  });
});


describe('SettingsPage', () => {
  it('states the scope of every group, because a screen preference and a system rule look alike', () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        breadcrumbs={crumbs}
        title="Appearance"
        groups={[
          {
            key: 'density',
            title: 'Density',
            description: 'How tightly rows are packed',
            scope: 'Applies to your screen only, on this device',
            children: <span>compact</span>,
          },
        ]}
      />
    );

    expect(html).toContain('Applies to your screen only');
    expect(html).toContain('Density');
  });
});
