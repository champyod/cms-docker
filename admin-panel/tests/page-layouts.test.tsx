import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DetailPage } from '@/components/patterns/DetailPage';
import { FormPage } from '@/components/patterns/FormPage';
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

describe('FormPage', () => {
  it('puts the error summary above the fields', () => {
    const html = renderToStaticMarkup(
      <FormPage
        breadcrumbs={crumbs}
        title="New task"
        errors={['Name is required']}
        submit={<button type="submit">Save</button>}
      >
        <label htmlFor="name">Name</label>
        <input id="name" />
      </FormPage>
    );

    expect(html.indexOf('This form needs a correction')).toBeLessThan(html.indexOf('id="name"'));
    // the reader just pressed submit, so this is the one alert that may interrupt
    expect(html).toContain('role="alert"');
  });

  it('says nothing extra when the form is clean', () => {
    const html = renderToStaticMarkup(
      <FormPage breadcrumbs={crumbs} title="New task" submit={<button type="submit">Save</button>}>
        <span>fields</span>
      </FormPage>
    );

    expect(html).not.toContain('role="alert"');
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
