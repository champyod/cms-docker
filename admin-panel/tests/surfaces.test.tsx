import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/th/contests/42/overview',
}));

import { DetailSurface, type DetailSurfaceProps } from '@/components/core/DetailSurface';
import { PageSurface, type PageSurfaceProps } from '@/components/core/PageSurface';
import type { SurfaceStatus } from '@/components/core/SurfaceState';
import { buildRoute } from '@/lib/navigation/routes';
import type { BreadcrumbItem, RouteTab } from '@/lib/navigation/types';

const breadcrumbs: readonly BreadcrumbItem[] = [
  { label: 'Contests', href: buildRoute('th', 'contests.list') },
  { label: 'Contest 42', href: buildRoute('th', 'contests.record', { id: 42 }) },
  { label: 'Overview' },
];

const tabs: readonly RouteTab[] = [
  {
    id: 'contests.tabs.overview',
    label: 'Overview',
    href: buildRoute('th', 'contests.tabs.overview', { id: 42 }),
    icon: <span data-testid="overview-icon">O</span>,
  },
  {
    id: 'contests.tabs.settings',
    label: 'Settings',
    href: buildRoute('th', 'contests.tabs.settings', { id: 42 }),
  },
];

function renderPage(status?: SurfaceStatus): string {
  const props = {
    breadcrumbs,
    title: 'Contests',
    description: 'Manage contests',
    actions: <button type="button">Create contest</button>,
    status,
    children: <div data-testid="page-content">Page content</div>,
    className: 'fixture-page',
  } satisfies PageSurfaceProps;
  return renderToStaticMarkup(<PageSurface {...props} />);
}

function renderDetail(status?: SurfaceStatus): string {
  const props = {
    breadcrumbs,
    title: 'Contest 42',
    description: 'Contest record',
    status,
    tabs,
    actions: <button type="button">Edit contest</button>,
    children: <div data-testid="detail-content">Detail content</div>,
    className: 'fixture-detail',
  } satisfies DetailSurfaceProps;
  return renderToStaticMarkup(<DetailSurface {...props} />);
}

describe('PageSurface', () => {
  it('renders breadcrumbs, title, description, actions, and children', () => {
    const html = renderPage();
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/th/contests"');
    expect(html).toContain('href="/th/contests/42"');
    expect(html).toContain('Contests');
    expect(html).toContain('Manage contests');
    expect(html).toContain('Create contest');
    expect(html).toContain('Page content');
  });

  it('keeps responsive and safe-area spacing without nesting a main element', () => {
    const html = renderPage();
    expect(html).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(html).toContain('md:pb-0');
    expect(html).not.toContain('<main');
  });

  it('stacks the description inside the title column instead of beside the title', () => {
    const html = renderPage();
    const titleColumnStart = html.indexOf('flex min-w-0 flex-col gap-2');
    const titleColumnEnd = html.indexOf('</div>', html.indexOf('Manage contests'));
    const titleColumn = html.slice(titleColumnStart, titleColumnEnd);
    // The description has to close the same column the title opens, so the actions
    // sibling sits after it rather than between the title and its description.
    expect(titleColumn).toContain('<h1');
    expect(titleColumn).toContain('Manage contests');
    expect(html.indexOf('Manage contests')).toBeLessThan(html.indexOf('Create contest'));
  });

  it('uses the exact public prop set', () => {
    const props = {
      breadcrumbs,
      title: 'Contests',
      description: 'Manage contests',
      actions: <button type="button">Create</button>,
      status: { kind: 'idle' },
      children: <div>Content</div>,
      className: 'fixture-page',
    } satisfies PageSurfaceProps;
    expect(Object.keys(props)).toEqual([
      'breadcrumbs',
      'title',
      'description',
      'actions',
      'status',
      'children',
      'className',
    ]);
  });
});

describe('DetailSurface', () => {
  it('renders route tabs, the active tab, icons, actions, and content', () => {
    const html = renderDetail();
    expect(html).toContain('href="/th/contests/42/overview"');
    expect(html).toContain('href="/th/contests/42/settings"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-testid="overview-icon"');
    expect(html).toContain('Edit contest');
    expect(html).toContain('Detail content');
  });

  it('uses the exact public prop set', () => {
    const props = {
      breadcrumbs,
      title: 'Contest 42',
      description: 'Contest record',
      status: { kind: 'idle' },
      tabs,
      actions: <button type="button">Edit</button>,
      children: <div>Content</div>,
      className: 'fixture-detail',
    } satisfies DetailSurfaceProps;
    expect(Object.keys(props)).toEqual([
      'breadcrumbs',
      'title',
      'description',
      'status',
      'tabs',
      'actions',
      'children',
      'className',
    ]);
  });
});

describe('surface state precedence', () => {
  it.each([
    [{ kind: 'loading', title: 'Loading contests' } satisfies SurfaceStatus, 'Loading contests'],
    [{ kind: 'error', title: 'Could not load contests' } satisfies SurfaceStatus, 'Could not load contests'],
    [{ kind: 'empty', title: 'No contests' } satisfies SurfaceStatus, 'No contests'],
    [{ kind: 'not-found', title: 'Not found' } satisfies SurfaceStatus, 'Not found'],
  ])('renders %s and suppresses feature children', (status, expectedText) => {
    const pageHtml = renderPage(status);
    const detailHtml = renderDetail(status);
    expect(pageHtml).toContain(expectedText);
    expect(detailHtml).toContain(expectedText);
    expect(pageHtml).not.toContain('Page content');
    expect(detailHtml).not.toContain('Detail content');
  });
});
