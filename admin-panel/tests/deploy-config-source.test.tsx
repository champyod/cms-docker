import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MismatchBanner } from '@/components/deployments/MismatchBanner';
import { ActiveContestCard } from '@/components/deployments/ActiveContestCard';

/**
 * The active contest is set in config.toml [contest] CONTEST_ID: the deploy writes it there and
 * `./cms config sync` regenerates .env from it. Copy that named the generated .env as the place the
 * value lives sent operators to edit a file the next sync overwrites, and made the mismatch banner
 * report a source the panel never compared.
 *
 * Why static markup: the values on screen are strings these components render, and a reader of the
 * banner is what the copy has to be true for. The confirm dialog is not covered here because Radix
 * renders its content into a portal, which server rendering does not produce.
 */
const CONTESTS = [
  { id: 10, name: 'Spring', is_active: false },
  { id: 12, name: 'Autumn', is_active: true },
];

describe('deploy copy names the file the active contest is set in', () => {
  const cardHtml = renderToStaticMarkup(
    <ActiveContestCard
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

  it('describes the activation as setting CONTEST_ID in config.toml', () => {
    expect(cardHtml).toContain('CONTEST_ID in config.toml');
    expect(cardHtml).toContain('restart the contest stack');
  });

  it('does not name the generated .env', () => {
    expect(cardHtml).not.toContain('env file');
    expect(cardHtml).not.toContain('.env');
  });
});

describe('mismatch banner names the sources it actually compares', () => {
  const bannerHtml = renderToStaticMarkup(
    <MismatchBanner activeContestId={12} activeContestName="Autumn" dbActiveContestId={10} containerContestId={10} />,
  );

  it('reports config.toml [contest] CONTEST_ID against the database and the container', () => {
    expect(bannerHtml).toContain('config.toml');
    expect(bannerHtml).toContain('CONTEST_ID');
    expect(bannerHtml).toContain('Mismatch between config.toml and database and config.toml and running container');
  });

  it('does not name the generated .env as a source', () => {
    expect(bannerHtml).not.toContain('.env');
    expect(bannerHtml).not.toContain('env file');
  });
});
