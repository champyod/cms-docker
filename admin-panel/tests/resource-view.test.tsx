import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetricsCard, ResourceView } from '@/components/resources/ResourceView';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import type { ServerStats } from '@/lib/live-frames';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';

function metrics(source: ServerStats['source'], networkSource: ServerStats['source']): ServerStats {
  return { cpu: 1, memory: 2, uptime: '3d', network: { rx: 1, tx: 2, source: networkSource }, loadAvg: ['0.10'], source };
}

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
  it('names the network figure with its own source, apart from the host figures', () => {
    const container = render(<MetricsCard serverStats={metrics('host', 'container')} />, en);
    expect(container).toContain(en.resources.containerSource);
    expect(container).not.toContain(en.resources.hostSource);

    const host = render(<MetricsCard serverStats={metrics('container', 'host')} />, en);
    expect(host).toContain(en.resources.hostSource);
    expect(host).not.toContain(en.resources.containerSource);
  });
  it('shows the network figures as unavailable, with no source, when neither could be read', () => {
    const html = render(<MetricsCard serverStats={{ ...metrics('host', 'host'), network: null }} />, en);
    expect(html).toContain(en.resources.networkTotal);
    expect(html).not.toContain(en.resources.hostSource);
    expect(html).not.toContain(en.resources.containerSource);
  });
});