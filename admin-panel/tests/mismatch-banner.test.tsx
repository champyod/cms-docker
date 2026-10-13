// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { MismatchBanner } from '@/components/deployments/MismatchBanner';

// Why: the panel compares the database's active contest with the id the running container serves.
// It never reads config.toml's CONTEST_ID here, so the banner must not name it as a source.
describe('MismatchBanner', () => {
  it('names the database and the running container, never config.toml', () => {
    const { container } = render(
      <MismatchBanner activeContestId={1} activeContestName="Spring" dbActiveContestId={1} containerContestId={2} />,
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/database/i);
    expect(text).toMatch(/running container/i);
    expect(text).not.toMatch(/config\.toml/i);
  });

  it('names only the database when no container id is known', () => {
    const { container } = render(
      <MismatchBanner activeContestId={4} activeContestName={null} dbActiveContestId={4} containerContestId={null} />,
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/database/i);
    expect(text).not.toMatch(/config\.toml/i);
  });
});
