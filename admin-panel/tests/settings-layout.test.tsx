import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SettingsPage } from '@/components/patterns/SettingsPage';

const crumbs = [{ label: 'Home', href: '/' }];

const groups = [
  {
    key: 'display',
    title: 'Display',
    description: 'Density, text size and contrast.',
    scope: 'Your screen only: stored on this device.',
    children: <p>Controls</p>,
  },
  {
    key: 'services',
    title: 'Services',
    description: 'The values config.toml holds.',
    scope: 'Everyone: these are this host’s values.',
    children: <p>Values</p>,
  },
];

describe('SettingsPage', () => {
  it('draws a group with the panel section frame, not with a card of its own', () => {
    const html = renderToStaticMarkup(<SettingsPage breadcrumbs={crumbs} title="Settings" groups={groups} />);

    // One heading level for every section; a group title is not allowed to outweigh the page title.
    const headings = [...html.matchAll(/<h2[^>]*>/g)].map((match) => match[0]);
    expect(headings).toHaveLength(2);
    for (const heading of headings) {
      expect(heading).toContain('text-base');
      expect(heading).not.toContain('font-semibold');
    }
  });

  it('states who each group reaches, beside what it controls', () => {
    const html = renderToStaticMarkup(<SettingsPage breadcrumbs={crumbs} title="Settings" groups={groups} />);

    expect(html).toContain('Density, text size and contrast.');
    expect(html).toContain('Your screen only: stored on this device.');
    expect(html).toContain('Everyone: these are this host’s values.');
  });

  it('keeps the save bar after every group, so a save covers what was read', () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        breadcrumbs={crumbs}
        title="Settings"
        groups={groups}
        saveBar={<button type="button">Save all</button>}
      />,
    );

    expect(html.indexOf('Everyone: these are this host’s values.')).toBeLessThan(html.indexOf('Save all'));
  });
});
