import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/en/administration/admins';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  usePathname: () => pathname,
}));

import en from '@/dictionaries/en.json';
import { ModuleTabShell, type ModuleTabShellProps } from '@/components/navigation/ModuleTabShell';
import { buildModuleTabs } from '@/lib/navigation/module-tabs';
import type { BreadcrumbItem, RouteTab } from '@/lib/navigation/types';

const ADMIN_TABS: readonly RouteTab[] = [
  { id: 'administration.admins', label: 'Admins', href: '/en/administration/admins' },
  { id: 'administration.groups', label: 'Groups', href: '/en/administration/groups' },
  { id: 'administration.audit', label: 'Audit', href: '/en/administration/audit' },
];

const BREADCRUMBS: readonly BreadcrumbItem[] = [
  { label: 'Home', href: '/en' },
  { label: 'Administration', href: '/en/administration/admins' },
];

const ADMIN_READER: ReadonlySet<string> = new Set([
  'admin:list',
  'admin:read',
  'group:list',
  'group:read',
  'audit:list',
  'audit:read',
]);

function renderShell(descriptions?: ModuleTabShellProps['descriptions']): string {
  const props = {
    breadcrumbs: BREADCRUMBS,
    title: 'Administration',
    description: 'Platform operators',
    tabs: ADMIN_TABS,
    actionsMap: {
      'administration.admins': <button type="button">Add Admin</button>,
      'administration.groups': <button type="button">Add Group</button>,
      'administration.audit': <button type="button">Export Audit</button>,
    },
    descriptions,
    children: <div>Tab content</div>,
    className: 'fixture-module',
  } satisfies ModuleTabShellProps;
  return renderToStaticMarkup(<ModuleTabShell {...props} />);
}

beforeEach(() => {
  pathname = '/en/administration/admins';
});

describe('ModuleTabShell', () => {
  it('renders the module header, one anchor per tab, and the child content', () => {
    const html = renderShell();
    expect(html).toContain('Administration');
    expect(html).toContain('Platform operators');
    for (const tab of ADMIN_TABS) expect(html).toContain(`href="${tab.href}"`);
    expect(html).toContain('Tab content');
  });

  it('shows only the active tab action beside the title', () => {
    const html = renderShell();
    expect(html).toContain('Add Admin');
    expect(html).not.toContain('Add Group');
    expect(html).not.toContain('Export Audit');
  });

  it('switches the title action when the URL moves to another tab', () => {
    pathname = '/en/administration/groups';
    const html = renderShell();
    expect(html).toContain('Add Group');
    expect(html).not.toContain('Add Admin');
  });

  it('treats a trailing slash as the same tab for both action and highlight', () => {
    pathname = '/en/administration/audit/';
    const html = renderShell();
    expect(html).toContain('Export Audit');
    expect(html).toContain('aria-current="page"');
  });

  it('renders no title action when the path matches no tab', () => {
    pathname = '/en/administration/groups/9';
    const html = renderShell();
    expect(html).not.toContain('Add Admin');
    expect(html).not.toContain('Add Group');
    expect(html).not.toContain('Export Audit');
    expect(html).toContain('Tab content');
  });
});

describe('ModuleTabShell per-tab descriptions', () => {
  const DESCRIPTIONS = {
    'administration.admins': 'Manage administrator accounts.',
    'administration.groups': 'Assign permissions to each group.',
    'administration.audit': 'Browse every recorded action.',
  } satisfies ModuleTabShellProps['descriptions'];

  it.each([
    ['/en/administration/admins', 'Manage administrator accounts.'],
    ['/en/administration/groups', 'Assign permissions to each group.'],
    ['/en/administration/audit', 'Browse every recorded action.'],
  ])('names the tab %s opened', (path, expected) => {
    pathname = path;
    const html = renderShell(DESCRIPTIONS);
    expect(html).toContain(expected);
    expect(html).not.toContain('Platform operators');
  });

  it('falls back to the module description for a tab with no line of its own', () => {
    pathname = '/en/administration/audit';
    const html = renderShell({ 'administration.admins': 'Manage administrator accounts.' });
    expect(html).toContain('Platform operators');
    expect(html).not.toContain('Manage administrator accounts.');
  });

  it('keeps the module description when no tab carries one', () => {
    const html = renderShell();
    expect(html).toContain('Platform operators');
  });
});

describe('buildModuleTabs', () => {
  it('exposes the permitted module rail as route tabs in group order', () => {
    expect(buildModuleTabs('administration', 'en', en, ADMIN_READER)).toEqual([
      {
        id: 'administration.admins',
        label: en.navigation.administration.admins.label,
        href: '/en/administration/admins',
      },
      {
        id: 'administration.groups',
        label: en.navigation.administration.groups.label,
        href: '/en/administration/groups',
      },
      {
        id: 'administration.audit',
        label: en.navigation.administration.audit.label,
        href: '/en/administration/audit',
      },
    ]);
  });

  it('omits a tab the reader may not open', () => {
    const tabs = buildModuleTabs('administration', 'en', en, new Set(['admin:list', 'admin:read']));
    expect(tabs.map((tab) => tab.id)).toEqual(['administration.admins']);
  });
});
