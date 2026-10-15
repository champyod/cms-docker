import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MismatchBanner } from '@/components/deployments/MismatchBanner';
import { ActiveContestCard } from '@/components/deployments/ActiveContestCard';

/**
 * The activation writes the database row: contests.is_active is the single source of truth for the
 * active contest, and the deploy runs `scripts/__config_sync.sh` after it. That sync never rewrites
 * [contest] CONTEST_ID — the key is the bootstrap a database with no contests table yet is read
 * from, which is why the panel reads the container's configured value and the shard's registry
 * binding beside it. Copy that named config.toml as a file the activation writes sent operators to
 * edit a key nothing on that path touches.
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

describe('deploy copy names the write the activation performs', () => {
  const cardHtml = renderToStaticMarkup(
    <ActiveContestCard
      shardBindings={BINDINGS}
      activeContestId={12}
      activeContestName="Autumn"
      availableContests={CONTESTS}
      selectedContestId={12}
      deployPhase="idle"
      hasChangedContest={false}
      onSelectContest={() => undefined}
      onActivate={() => undefined}
      onCancel={() => undefined}
    />,
  );

  it('describes the activation as marking the contest active in the database and syncing', () => {
    expect(cardHtml).toContain('mark the contest as active in the database');
    expect(cardHtml).toContain('run the config sync');
    expect(cardHtml).toContain('restart the contest stack');
  });

  it('does not claim the activation sets CONTEST_ID in config.toml', () => {
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
      selectedContestId={12}
      deployPhase="idle"
      hasChangedContest={false}
      onSelectContest={() => undefined}
      onActivate={() => undefined}
      onCancel={() => undefined}
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
        selectedContestId={null}
        deployPhase="idle"
        hasChangedContest={false}
        onSelectContest={() => undefined}
        onActivate={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(emptyHtml).toContain('No enabled registry row binds a shard to a contest.');
  });
});
