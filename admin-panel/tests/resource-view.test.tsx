import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageSurface } from '@/components/core/PageSurface';
import { MetricsCard, ResourceView } from '@/components/resources/ResourceView';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import type { ModulePageCopy } from '@/components/navigation/ModulePageCopy';

const copy: ModulePageCopy = {
  group: 'fixture-group',
  title: 'fixture-resources',
  description: 'fixture-description',
};

// Why this marker: `density:p-3` sits on a card inside PageSurface's children, so its presence
// can only differ between the two renders because of the blocking status, never because of copy.
const CHILD_MARKER = 'density:p-3';

function render(node: React.ReactNode, dict: typeof en): string {
  return renderToStaticMarkup(
    <DictionaryProvider dict={dict}>{node}</DictionaryProvider>,
  );
}

describe('ResourceView', () => {
  it('surfaces the module shell copy and the surface density while loading', () => {
    const html = render(<ResourceView copy={copy} />, en);
    expect(html).toContain('data-surface="page"');
    expect(html).toContain('fixture-group');
    expect(html).toContain('fixture-resources');
    expect(html).toContain('fixture-description');
    expect(html).toContain('density:space-y-4');
  });
  it('blocks its children on the loading status and releases them once it clears', () => {
    const loading = render(<ResourceView copy={copy} />, en);
    expect(loading).toContain(en.resources.loading);
    expect(loading).not.toContain(CHILD_MARKER);

    const ready = render(
      <PageSurface
        breadcrumbs={[{ label: copy.group }, { label: copy.title }]}
        title={copy.title}
        description={copy.description}
        className="density:space-y-4"
      >
        <MetricsCard serverStats={null} />
      </PageSurface>,
      en,
    );
    expect(ready).toContain(CHILD_MARKER);
    expect(ready).not.toContain(en.resources.loading);
  });
  it('localizes the metrics card labels', () => {
    const thai = render(<MetricsCard serverStats={null} />, th);
    expect(thai).toContain(th.resources.uptime);
    expect(thai).toContain(th.resources.loadAvg);
    expect(thai).toContain(th.resources.networkTotal);
    expect(thai).not.toContain(en.resources.uptime);
  });
  it('compacts the metrics card under density', () => {
    expect(render(<MetricsCard serverStats={null} />, en)).toContain('density:p-3');
  });
});
