import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetricsCard, ResourceView } from '@/components/resources/ResourceView';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';

// Why this marker: `density:p-3` sits on the metrics card, so its presence can only differ
// between the two renders because of the loading state, never because of the shell around it.
const CHILD_MARKER = 'density:p-3';

function render(node: React.ReactNode, dict: typeof en): string {
  return renderToStaticMarkup(
    <DictionaryProvider dict={dict}>{node}</DictionaryProvider>,
  );
}

describe('ResourceView', () => {
  it('renders the loading state the module shell sits above, not its own page surface', () => {
    const html = render(<ResourceView />, en);
    expect(html).toContain(en.resources.loading);
    expect(html).not.toContain('data-surface="page"');
  });
  it('blocks its children on the loading status and releases them once it clears', () => {
    const loading = render(<ResourceView />, en);
    expect(loading).toContain(en.resources.loading);
    expect(loading).not.toContain(CHILD_MARKER);

    const ready = render(<MetricsCard serverStats={null} />, en);
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