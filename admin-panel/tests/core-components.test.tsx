import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Search } from 'lucide-react';
import { EmptyState } from '@/components/core/EmptyState';
import { Input } from '@/components/core/Input';
import { Tabs, type TabItem } from '@/components/core/Tabs';
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

describe('Tabs', () => {
  const items: readonly TabItem[] = [
    { id: 'admins', label: 'Admins', href: '/en/permissions?tab=admins' },
    { id: 'groups', label: 'Groups', href: '/en/permissions?tab=groups' },
  ];

  it('marks only the active tab as the current page', () => {
    const html = renderToStaticMarkup(
      <Tabs items={items} activeId="groups" ariaLabel="Permission sections" />
    );
    expect(html).toContain('aria-label="Permission sections"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    // Why: the selection lives in the URL, so the active marker must follow the id, not the first link.
    expect(html).toMatch(/aria-current="page"[^>]*href="\/en\/permissions\?tab=groups"/);
  });

  it('renders every tab as a link, including inactive ones', () => {
    const html = renderToStaticMarkup(
      <Tabs items={items} activeId="admins" ariaLabel="Permission sections" />
    );
    expect(html).toContain('href="/en/permissions?tab=admins"');
    expect(html).toContain('href="/en/permissions?tab=groups"');
    expect(html).toContain('Groups');
  });

  it('renders nothing when no tab is permitted', () => {
    expect(renderToStaticMarkup(<Tabs items={[]} activeId="" ariaLabel="Permission sections" />)).toBe('');
  });
});

describe('Input uncontrolled support', () => {
  it('renders no value attribute when used uncontrolled', () => {
    const html = renderToStaticMarkup(<Input name="username" label="Username" />);
    expect(html).not.toContain('value=""');
  });

  it('passes value through when used controlled', () => {
    const html = renderToStaticMarkup(
      <Input name="username" label="Username" value="admin" onChange={() => undefined} />
    );
    expect(html).toContain('value="admin"');
  });
});
