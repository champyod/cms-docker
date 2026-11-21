// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useRegisterUserListRefresh,
  useUserListRefresh,
} from '@/components/users/useUserListRefresh';

// Why the pair is tested together: the header that owns the create dialogs renders in a
// different client tree from the list, so the only thing keeping a save from stranding a
// stale list is this module handle surviving between them.
function Bridge(): React.JSX.Element {
  const refresh = useUserListRefresh();
  return <button type="button" onClick={() => refresh()}>save</button>;
}

function List({ onSaved }: { readonly onSaved: () => void }): null {
  useRegisterUserListRefresh(onSaved);
  return null;
}

afterEach(cleanup);

describe('user list refresh bridge', () => {
  it('runs the list refresh when a header-owned dialog saves', () => {
    const onSaved = vi.fn();
    const view = render(
      <>
        <List onSaved={onSaved} />
        <Bridge />
      </>,
    );

    view.getByRole('button', { name: 'save' }).click();

    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('is a no-op while no list is mounted, rather than throwing', () => {
    const view = render(<Bridge />);
    expect(() => view.getByRole('button', { name: 'save' }).click()).not.toThrow();
  });

  it('stops reaching a list once it unmounts', () => {
    const onSaved = vi.fn();
    const view = render(
      <>
        <List onSaved={onSaved} />
        <Bridge />
      </>,
    );

    view.unmount();
    render(<Bridge />).getByRole('button', { name: 'save' }).click();

    expect(onSaved).not.toHaveBeenCalled();
  });
});