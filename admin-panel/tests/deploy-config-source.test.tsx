import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MismatchBanner } from '@/components/deployments/MismatchBanner';
import { ActiveContestCard } from '@/components/deployments/ActiveContestCard';

/**
 * The deployments card states what each shard serves and offers no lever of its own: a shard is
 * moved by writing its registry row, which a running instance re-reads within seconds, so the
 * control that activated a contest by recreating the contest stack — the one path that could
 * restart the board mid-contest — is gone. These tests pin that absence, because a reinstated
 * control would read as harmless copy rather than as the restart lever it is.
 *
 * Why static markup: the values on screen are strings these components render, and a reader of the
 * banner is what the copy has to be true for. The confirm dialog is not covered here because Radix
 * renders its content into a portal, which server rendering does not produce.
 */
const CONTESTS = [
  { id: 10, name: 'Spring', is_active: false },
  { id: 12, name: 'Autumn', is_active: true },
];

const BINDINGS = [
  { id: 1, name: 'web-0', role: 'ContestWebServer', shard: 0, contestId: 12 },
  { id: 2, name: 'proxy-1', role: 'ProxyService', shard: 1, contestId: 10 },
];

describe('the served-contest card offers no restart lever', () => {
  const cardHtml = renderToStaticMarkup(
    <ActiveContestCard
      shardBindings={BINDINGS}
      activeContestId={12}
      activeContestName="Autumn"
      availableContests={CONTESTS}
    />,
  );

  it('renders no control that would recreate the contest stack', () => {
    expect(cardHtml).not.toContain('Activate');
    expect(cardHtml).not.toContain('Select Contest to Deploy');
    expect(cardHtml).not.toContain('restart the contest');
    expect(cardHtml).not.toContain('<select');
    expect(cardHtml).not.toContain('<button');
  });

  it('names the registry as what decides what a running instance serves', () => {
    expect(cardHtml).toContain('From the service registry');
    expect(cardHtml).not.toContain('CONTEST_ID in config.toml');
    expect(cardHtml).not.toContain('.env');
  });
});

describe('mismatch banner names the sources it actually compares', () => {
  const bannerHtml = renderToStaticMarkup(
    <MismatchBanner activeContestId={12} activeContestName="Autumn" dbActiveContestId={12} containerContestId={1} boundContestId={3} boundContestSource="registry" />,
  );

  it('reports the database row against the configured value and the registry binding', () => {
    expect(bannerHtml).toContain('database');
    expect(bannerHtml).toContain('configured with CONTEST_ID');
    expect(bannerHtml).toContain('service registry binds the contest web server');
  });

  it('never calls the configured value the contest the running container serves', () => {
    expect(bannerHtml).not.toContain('running container serves');
    expect(bannerHtml).not.toContain('config.toml');
  });

  it('does not name the generated .env as a source', () => {
    expect(bannerHtml).not.toContain('.env');
    expect(bannerHtml).not.toContain('env file');
  });
});

describe('the active-contest view shows the per-shard registry truth', () => {
  const cardHtml = renderToStaticMarkup(
    <ActiveContestCard
      shardBindings={BINDINGS}
      activeContestId={12}
      activeContestName="Autumn"
      availableContests={CONTESTS}
    />,
  );

  it('renders one row per bound shard with its role and the contest it serves', () => {
    expect(cardHtml).toContain('shard 0');
    expect(cardHtml).toContain('ContestWebServer');
    expect(cardHtml).toContain('#12 — Autumn');
    expect(cardHtml).toContain('shard 1');
    expect(cardHtml).toContain('ProxyService');
    expect(cardHtml).toContain('#10 — Spring');
  });

  it('stops presenting a single active contest id as the truth', () => {
    expect(cardHtml).not.toContain('Current Active Contest');
    expect(cardHtml).not.toContain('Currently deployed contest stack');
    // The flag survives only as the labelled default for an instance no registry row names.
    expect(cardHtml).toContain('Deployment default (contests.is_active)');
  });

  it('shows the empty table and the fallback note when no shard is bound', () => {
    const emptyHtml = renderToStaticMarkup(
      <ActiveContestCard
        shardBindings={[]}
        activeContestId={12}
        activeContestName="Autumn"
        availableContests={CONTESTS}
      />,
    );
    expect(emptyHtml).toContain('No enabled registry row binds a shard to a contest.');
  });
});
