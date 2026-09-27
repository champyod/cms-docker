import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import DashboardPage from '@/app/[locale]/(authenticated)/page';
import ContestsPage from '@/app/[locale]/(authenticated)/contests/page';
import TasksPage from '@/app/[locale]/(authenticated)/tasks/page';
import { getContests } from '@/app/actions/contests';
import { getTasks } from '@/app/actions/tasks';
import { getServiceStatus } from '@/app/actions/services';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/permissions';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/i18n', () => ({
  getDictionary: vi.fn(async (locale: string) => (locale === 'th' ? th : en)),
}));

vi.mock('@/lib/permissions', () => ({
  checkPermission: vi.fn(async () => true),
  getPermissions: vi.fn(async () => new Set(['contest:list', 'task:list', 'user:read'])),
}));

vi.mock('@/app/actions/contests', () => ({ getContests: vi.fn() }));
vi.mock('@/app/actions/tasks', () => ({ getTasks: vi.fn() }));
vi.mock('@/app/actions/services', () => ({ getServiceStatus: vi.fn() }));

vi.mock('@/components/contests/ContestList', () => ({ ContestList: vi.fn(() => null) }));
vi.mock('@/components/tasks/TaskList', () => ({ TaskList: vi.fn(() => null) }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    users: { count: vi.fn(async () => 3) },
    contests: { count: vi.fn(async () => 2) },
    submissions: { count: vi.fn(async () => 5), findMany: vi.fn(async () => []) },
  },
}));

const LOCALES = ['en', 'th'] as const;

function headerOf(html: string): string {
  return html.slice(html.indexOf('data-testid="surface-header"'));
}

async function renderContests(locale: string): Promise<string> {
  vi.mocked(getContests).mockResolvedValue({ contests: [], totalPages: 1 } as never);
  const element = await ContestsPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({ page: '1', search: '' }),
  });
  return renderToStaticMarkup(element);
}

async function renderTasks(locale: string): Promise<string> {
  vi.mocked(getTasks).mockResolvedValue({ tasks: [], totalPages: 1 } as never);
  const element = await TasksPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({ page: '1', search: '' }),
  });
  return renderToStaticMarkup(element);
}

async function renderDashboard(locale: string): Promise<string> {
  vi.mocked(getServiceStatus).mockResolvedValue({
    success: true,
    status: 'online',
    running: 3,
    total: 3,
  } as never);
  const element = await DashboardPage({ params: Promise.resolve({ locale }) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkPermission).mockResolvedValue(true);
});

describe('direct page surfaces', () => {
  it.each(LOCALES)('renders the contests list on the shared surface in %s', async (locale) => {
    const dict = locale === 'th' ? th : en;
    const header = headerOf(await renderContests(locale));

    expect(header).toContain('data-testid="surface-header"');
    expect(header).toContain(dict.contests.title);
    expect(header).toContain(dict.contests.subtitle);
  });

  it.each(LOCALES)('renders the tasks list on the shared surface in %s', async (locale) => {
    const dict = locale === 'th' ? th : en;
    const header = headerOf(await renderTasks(locale));

    expect(header).toContain('data-testid="surface-header"');
    expect(header).toContain(dict.tasks.title);
    expect(header).toContain(dict.tasks.subtitle);
  });

  it.each(LOCALES)('renders the dashboard on the shared surface in %s', async (locale) => {
    const dict = locale === 'th' ? th : en;
    const header = headerOf(await renderDashboard(locale));

    expect(header).toContain('data-testid="surface-header"');
    expect(header).toContain(dict.dashboard.welcome);
    expect(header).toContain(dict.dashboard.description);
  });

  it('gives the contests list the Dashboard crumb without repeating the page', async () => {
    const nav = await renderContests('en');
    const trail = nav.slice(nav.indexOf('<nav'), nav.indexOf('</nav>'));

    expect(trail).toContain('href="/en"');
    expect(trail).toContain('Dashboard');
    expect(trail).not.toContain(en.contests.title);
  });

  it('gives the dashboard no crumb, because its own name is the only one it could show', async () => {
    const html = await renderDashboard('en');

    expect(html).not.toContain('aria-label="Breadcrumb"');
  });
});

describe('direct page concealment', () => {
  it('conceals the contests list from a reader without contest:list', async () => {
    vi.mocked(checkPermission).mockResolvedValue(false);

    await expect(
      ContestsPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ page: '1', search: '' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('conceals the tasks list from a reader without task:list', async () => {
    vi.mocked(checkPermission).mockResolvedValue(false);

    await expect(
      TasksPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ page: '1', search: '' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('conceals the dashboard from a reader without all:all', async () => {
    vi.mocked(checkPermission).mockResolvedValue(false);

    await expect(DashboardPage({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('reads no contest row for a concealed reader', async () => {
    vi.mocked(checkPermission).mockResolvedValue(false);

    await expect(
      ContestsPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ page: '1', search: '' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(getContests).not.toHaveBeenCalled();
    expect(prisma.users.count).not.toHaveBeenCalled();
  });
});

describe('direct page copy parity', () => {
  it('resolves every direct page title and description in both locales', () => {
    for (const dict of [en, th]) {
      for (const text of [
        dict.dashboard.welcome,
        dict.dashboard.description,
        dict.contests.title,
        dict.contests.subtitle,
        dict.tasks.title,
        dict.tasks.subtitle,
      ]) {
        expect(text.trim()).not.toBe('');
      }
    }
  });
});
