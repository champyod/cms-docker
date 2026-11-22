import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ModePage } from '@/components/patterns/ModePage';

const crumbs = [{ label: 'Home', href: '/' }];
const modes = [
  { key: 'from-file', label: 'From file', href: '?mode=from-file' },
  { key: 'schedules', label: 'Schedules', href: '?mode=schedules' },
];

describe('ModePage', () => {
  it('reads freshness as a note, like every other layout', () => {
    const html = renderToStaticMarkup(
      <ModePage breadcrumbs={crumbs} title="Backup" modes={modes} activeKey="from-file" freshness="checked a moment ago">
        <p>Restore</p>
      </ModePage>,
    );

    expect(html).toMatch(/text-xs[^>]*>checked a moment ago/);
  });

  it('names the switcher even when the shell owns the page title', () => {
    const html = renderToStaticMarkup(
      <ModePage
        breadcrumbs={crumbs}
        ownsHeader={false}
        modesLabel="Backup and restore modes"
        modes={modes}
        activeKey="from-file"
      >
        <p>Restore</p>
      </ModePage>,
    );

    expect(html).toContain('Backup and restore modes');
  });

  it('shows only the active workflow, and names the ones this account cannot open', () => {
    const html = renderToStaticMarkup(
      <ModePage
        breadcrumbs={crumbs}
        title="Backup"
        modes={modes}
        activeKey="from-file"
        unavailable={[{ label: 'Schedules', reason: 'needs the backup schedule permission' }]}
      >
        <p>Restore from a file</p>
      </ModePage>,
    );

    expect(html).toContain('Restore from a file');
    expect(html).toContain('needs the backup schedule permission');
  });

  it('refuses an active mode the page does not list', () => {
    // A key that is not in the list highlights no tab, which reads as a broken switcher.
    expect(() =>
      renderToStaticMarkup(
        <ModePage breadcrumbs={crumbs} title="Backup" modes={modes} activeKey="from-dir">
          <p>Restore</p>
        </ModePage>,
      ),
    ).toThrow('is not one of the modes this page lists');
  });
});
