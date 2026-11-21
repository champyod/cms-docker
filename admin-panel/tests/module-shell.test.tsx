import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/en/administration/admins';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

import { ModuleShell, type ModuleShellProps } from '@/components/navigation/ModuleShell';
import type { ModuleFieldItem } from '@/lib/navigation/module-nav';
import type { BreadcrumbItem } from '@/lib/navigation/types';

const ADMIN_FIELDS: readonly ModuleFieldItem[] = [
  { id: 'administration.admins', label: 'Admins', href: '/en/administration/admins' },
  { id: 'administration.groups', label: 'Groups', href: '/en/administration/groups' },
  { id: 'administration.audit', label: 'Audit', href: '/en/administration/audit' },
];

const BREADCRUMBS: readonly BreadcrumbItem[] = [
  { label: 'Home', href: '/en' },
  { label: 'Administration' },
];

function renderShell(descriptions: ModuleShellProps['descriptions'] = {}): string {
  const props = {
    breadcrumbs: BREADCRUMBS,
    fields: ADMIN_FIELDS,
    descriptions,
    actionsMap: {
      'administration.admins': <button type="button">Add Admin</button>,
      'administration.groups': <button type="button">Add Group</button>,
      'administration.audit': <button type="button">Export Audit</button>,
    },
    fallbackTitle: 'Administration',
    children: <div>Field content</div>,
    className: 'fixture-module',
  } satisfies ModuleShellProps;
  return renderToStaticMarkup(<ModuleShell {...props} />);
}

beforeEach(() => {
  pathname = '/en/administration/admins';
});

describe('ModuleShell', () => {
  it('names the field the URL opened, carries the trail, and renders its content', () => {
    const html = renderShell();
    expect(html).toContain('Admins');
    expect(html).toContain('Home');
    expect(html).toContain('Field content');
    expect(html).toContain('fixture-module');
  });

  it('renders no tab strip, because the sidebar owns field navigation', () => {
    expect(renderShell()).not.toContain('Record sections');
  });

  it('shows only the active field action beside the title', () => {
    const html = renderShell();
    expect(html).toContain('Add Admin');
    expect(html).not.toContain('Add Group');
    expect(html).not.toContain('Export Audit');
  });

  it('switches the title action when the URL moves to another field', () => {
    pathname = '/en/administration/groups';
    const html = renderShell();
    expect(html).toContain('Add Group');
    expect(html).not.toContain('Add Admin');
  });

  it('treats a trailing slash as the same field for both title and action', () => {
    pathname = '/en/administration/audit/';
    const html = renderShell();
    expect(html).toContain('Audit');
    expect(html).toContain('Export Audit');
  });

  it('falls back to the group title where no field claims the path', () => {
    pathname = '/en/administration/groups/9';
    const html = renderShell();
    expect(html).toContain('Administration');
    expect(html).not.toContain('Add Admin');
    expect(html).not.toContain('Add Group');
    expect(html).toContain('Field content');
  });
});

describe('ModuleShell field descriptions', () => {
  const DESCRIPTIONS = {
    'administration.admins': 'Manage administrator accounts.',
    'administration.groups': 'Assign permissions to each group.',
    'administration.audit': 'Browse every recorded action.',
  } satisfies ModuleShellProps['descriptions'];

  it.each([
    ['/en/administration/admins', 'Manage administrator accounts.'],
    ['/en/administration/groups', 'Assign permissions to each group.'],
    ['/en/administration/audit', 'Browse every recorded action.'],
  ])('names the field %s opened', (path, expected) => {
    pathname = path;
    const html = renderShell(DESCRIPTIONS);
    expect(html).toContain(expected);
  });

  it('renders no line for a field the map does not cover', () => {
    pathname = '/en/administration/audit';
    const html = renderShell({ 'administration.admins': 'Manage administrator accounts.' });
    expect(html).toContain('Audit');
    expect(html).not.toContain('Manage administrator accounts.');
  });
});
