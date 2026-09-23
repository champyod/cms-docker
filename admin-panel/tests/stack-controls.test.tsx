import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContainerStackControls } from '@/components/containers/ContainerStackControls';

describe('ContainerStackControls', () => {
  it('renders wrapping buttons with density spacing', () => {
    const html = renderToStaticMarkup(
      <ContainerStackControls containers={[]} actionLoading={null} onCompose={() => undefined} />,
    );
    expect(html).toContain('Stack Controls');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('min-w-0');
  });
});
