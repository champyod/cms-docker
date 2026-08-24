import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Search } from 'lucide-react';
import { EmptyState } from '@/components/core/EmptyState';
import {
  STATUS_VARIANTS,
  mapStatusToVariant,
  StatusBadge,
  type StatusType,
} from '@/components/core/StatusBadge';

describe('EmptyState', () => {
  it('renders title and description', () => {
    const html = renderToStaticMarkup(
      <EmptyState icon={Search} title="No contests" description="Create one to begin" />
    );
    expect(html).toContain('No contests');
    expect(html).toContain('Create one to begin');
  });

  it('omits description and action when not provided', () => {
    const html = renderToStaticMarkup(<EmptyState title="Nothing here" />);
    expect(html).toContain('Nothing here');
    expect(html).not.toContain('<button');
  });

  it('renders action button when actionLabel and onAction are provided', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="Empty" actionLabel="Add item" onAction={() => undefined} />
    );
    expect(html).toContain('<button');
    expect(html).toContain('Add item');
  });
});

describe('StatusBadge variant mapping', () => {
  it('maps semantic statuses to Badge variants', () => {
    expect(STATUS_VARIANTS.ok.variant).toBe('success');
    expect(STATUS_VARIANTS.degraded.variant).toBe('warning');
    expect(STATUS_VARIANTS.down.variant).toBe('destructive');
  });

  it('falls back to down config for unknown status', () => {
    const unknown = 'bogus' as unknown as StatusType;
    expect(mapStatusToVariant(unknown)).toBe(STATUS_VARIANTS.down);
  });

  it('renders label and container detail', () => {
    const html = renderToStaticMarkup(<StatusBadge status="degraded" running={2} total={3} />);
    expect(html).toContain('Degraded');
    expect(html).toContain('2/3 containers running');
  });
});
