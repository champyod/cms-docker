// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { UserBulkCreateCsv } from '@/components/users/UserBulkCreateCsv';

afterEach(() => cleanup());

vi.mock('@/lib/apiClient', () => ({
  apiClient: { post: vi.fn(() => new Promise(() => undefined)) },
}));

const SPECIAL_LABEL = 'Special symbols (@ # $ % ...)';

function openDialog(): void {
  render(
    <DictionaryProvider dict={en}>
      <UserBulkCreateCsv
        isOpen
        onClose={() => undefined}
        onSuccess={() => undefined}
        contests={[]}
        canReadContests={false}
        navigation={en.navigation}
      />
    </DictionaryProvider>,
  );
}

describe('bulk add credential templates', () => {
  it('replaces the random buttons with one template field per credential', () => {
    openDialog();

    expect(screen.getByLabelText('Username template')).not.toBeNull();
    expect(screen.getByLabelText('Password template')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Fill Empty Credentials' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Random/ })).toBeNull();
  });

  it('offers the username alphabet without symbols and the password alphabet with them', () => {
    openDialog();
    const options = screen.getAllByRole('button', { name: 'Template options' });

    fireEvent.click(options[0]);
    expect(screen.queryByText(SPECIAL_LABEL)).toBeNull();

    fireEvent.click(options[1]);
    expect(screen.getByText(SPECIAL_LABEL)).not.toBeNull();
  });
});
