import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardState, DashboardSurface, fill, type DashboardLabels } from '@/components/dashboard/DashboardSurface';
import { DashboardPage } from '@/components/patterns/DashboardPage';

const labels: DashboardLabels = {
  serviceState: { ok: 'All services are running', degraded: 'Some services are not running', down: 'Services have stopped' },
  checkedAt: 'checked {count}',
  servicesTitle: 'Services',
  servicesDetail: 'container orchestration',
  stats: {
    totalUsers: 'Total Users',
    totalContests: 'Total Contests',
    totalSubmissions: 'Total Submissions',
    enrolled: '{count} enrolled in running contests',
    activeNow: '{count} running now',
    pending: '{count} waiting for a score',
  },
  activity: { title: 'Recent activity', empty: 'No recent activity', user: 'User', task: 'Task', when: 'When' },
};

const stats = {
  usersCount: 412,
  contestsCount: 9,
  activeContestsCount: 2,
  submissionsCount: 8412,
  pendingSubmissions: 214,
  activeContesters: 88,
};

const activity = [
  { id: 1, username: 'somchai', taskName: 'encoder', when: '14:02' },
  { id: 2, username: 'malee', taskName: 'decoder', when: '14:01' },
];

// The page is now the composition of an archetype and a surface, so the tests render it the way
// the route does - the ordering guarantee belongs to the archetype, not to string order in one file.
function render(status: 'ok' | 'degraded' | 'down') {
  const service = { status, running: 3, total: 4, down: status === 'ok' ? [] : [{ name: 'cms-evaluation-service', state: 'exited' }], checkedAt: '14:00' } as const;
  return renderToStaticMarkup(
    <DashboardPage
      breadcrumbs={[{ label: 'Home', href: '/' }]}
      title="Welcome back"
      state={<DashboardState service={service} labels={labels} stats={stats} />}
      totals={[
        { label: labels.stats.totalUsers, value: stats.usersCount, reference: fill(labels.stats.enrolled, stats.activeContesters) },
        { label: labels.stats.totalContests, value: stats.contestsCount, reference: fill(labels.stats.activeNow, stats.activeContestsCount) },
        { label: labels.stats.totalSubmissions, value: stats.submissionsCount, reference: fill(labels.stats.pending, stats.pendingSubmissions) },
        { label: labels.servicesTitle, value: `${service.running}/${service.total}`, reference: labels.servicesDetail },
      ]}
      locale="en"
    >
      <DashboardSurface activity={activity} labels={labels} />
    </DashboardPage>
  );
}

describe('DashboardSurface', () => {
  it('leads with the state of the service, not with a count', () => {
    const html = render('degraded');

    // Topic 8d: the main message of an incident is the state; the number is its measurement.
    expect(html.indexOf(labels.serviceState.degraded)).toBeLessThan(html.indexOf(labels.stats.totalUsers));
  });

  it('stays quiet when nothing is wrong, and still dates the claim', () => {
    const html = render('ok');

    expect(html).toContain(labels.serviceState.ok);
    expect(html).toContain('checked 14:00');
    // no alert region when there is nothing to alert about
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });

  it('never colours a number that is not a status', () => {
    const html = render('down');

    // Colour carries meaning in this system: warning/info on a label would read as state.
    expect(html).not.toContain('text-warning');
    expect(html).not.toContain('text-info');
    expect(html).not.toContain('text-primary');
  });

  it('renders activity as 32px table rows', () => {
    const html = render('ok');

    expect(html).toContain('h-8');
    expect(html).toContain('<table');
    expect(html).toContain('somchai');
  });

  it('uses primitives, not raw controls', () => {
    const html = render('degraded');

    expect(html).not.toContain('<button');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<input');
  });

  it('names the services that are not running, because a count cannot say what to fix', () => {
    const html = render('degraded');

    expect(html).toContain('cms-evaluation-service');
    expect(html).toContain('exited');
  });

  it('names nothing when every service is running', () => {
    const html = render('ok');

    expect(html).not.toContain('cms-evaluation-service');
  });

  it('fills the count placeholder without touching the rest of the sentence', () => {
    expect(fill('{count} waiting for a score', 214)).toBe('214 waiting for a score');
    expect(fill('ลงทะเบียน {count} คน', 88)).toBe('ลงทะเบียน 88 คน');
  });
});
