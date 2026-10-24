// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { MismatchBanner } from '@/components/deployments/MismatchBanner';

// Why: the panel compares three values — the database's active row, the CONTEST_ID the stack was
// configured with, and the shard's registry binding, which is the one the running server actually
// resolves its contest from. None of them is config.toml's CONTEST_ID, so the banner must not name
// the file as a source.
describe('MismatchBanner', () => {
  it('names every source it compares, and never config.toml', () => {
    const { container } = render(
      <MismatchBanner activeContestId={1} activeContestName="Spring" dbActiveContestId={1} containerContestId={2} boundContestId={3} boundContestSource="registry" />,
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/database/i);
    expect(text).toMatch(/configured with CONTEST_ID/i);
    expect(text).toMatch(/service registry/i);
    expect(text).not.toMatch(/config\.toml/i);
    expect(text).not.toMatch(/running container serves/i);
  });

  it('names only the database when no other source holds an id', () => {
    const { container } = render(
      <MismatchBanner activeContestId={4} activeContestName={null} dbActiveContestId={4} containerContestId={null} boundContestSource={null} />,
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/database/i);
    expect(text).not.toMatch(/config\.toml/i);
    expect(text).not.toMatch(/mismatch:/i);
  });

  it('reports the registry binding as the disagreeing source when the others agree', () => {
    const { container } = render(
      <MismatchBanner activeContestId={1} activeContestName="Spring" dbActiveContestId={1} containerContestId={1} boundContestId={5} boundContestSource="registry" />,
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/Mismatch: the service registry disagrees with the other sources\./);
    // The button cannot clear this one, so the advice names the row to edit instead.
    expect(text).toMatch(/edit it in the panel's service registry/);
    expect(text).not.toMatch(/Activate & Restart Stack rewrites/);
  });

  it('never names the registry when the deployment default answered the bound read', () => {
    // The default answers with the database's own id, which is already a source of its own.
    const { container } = render(
      <MismatchBanner activeContestId={1} activeContestName="Spring" dbActiveContestId={1} containerContestId={2} boundContestId={1} boundContestSource="deployment" />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/service registry/i);
    expect(text).toMatch(/Mismatch: the database and the configured CONTEST_ID disagree with each other\./);
  });

  it('sends the operator to the registry row when the configured value disagrees', () => {
    const { container } = render(
      <MismatchBanner activeContestId={2} activeContestName="Spring" dbActiveContestId={2} containerContestId={5} boundContestId={2} boundContestSource="registry" />,
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/Mismatch: the configured CONTEST_ID disagrees with the other sources\./);
    // The activation control is retired, so the advice names the one write that moves a shard.
    expect(text).toMatch(/the registry row for its shard/);
    expect(text).not.toMatch(/Activate & Restart Stack/);
    expect(text).not.toMatch(/edit it in the panel's service registry/);
  });
});
