// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { UserBulkEditDialog } from '@/components/users/UserBulkEditDialog';
import type { SelectedUser } from '@/components/users/bulkEditActions';

afterEach(() => cleanup());

vi.mock('@/lib/apiClient', () => ({ apiClient: { post: vi.fn(() => new Promise(() => undefined)) } }));
vi.mock('@/app/actions/users', () => ({ revealUserPassword: vi.fn(() => Promise.resolve({ success: true, data: null })) }));
vi.mock('@/app/actions/teams', () => ({ getTeams: vi.fn(() => Promise.resolve({ success: true, data: [] })) }));

const SPECIAL_LABEL = 'Special symbols (@ # $ % ...)';

const SELECTED: SelectedUser[] = [
  { id: 1, first_name: 'Ada', last_name: 'Lovelace', username: 'ada', email: 'a@b.c', password: null },
];

function openDialog(): void {
  render(
    <DictionaryProvider dict={en}>
      <UserBulkEditDialog
        isOpen
        onClose={() => undefined}
        selectedUsers={SELECTED}
        contests={[]}
        canReadContests={false}
        navigation={en.navigation}
        onSuccess={() => undefined}
      />
    </DictionaryProvider>,
  );
}

describe('bulk edit credential templates', () => {
  it('offers one template field per credential beside the regenerate actions', () => {
    openDialog();

    expect(screen.getByLabelText('Username template')).not.toBeNull();
    expect(screen.getByLabelText('Password template')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Regenerate Username' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Regenerate Password' })).not.toBeNull();
  });

  it('offers the username alphabet without symbols and the password alphabet with them', () => {
    openDialog();
    const options = screen.getAllByRole('button', { name: 'Template options' });

    fireEvent.click(options[0]);
    expect(screen.queryByText(SPECIAL_LABEL)).toBeNull();

    fireEvent.click(options[1]);
    expect(screen.getByText(SPECIAL_LABEL)).not.toBeNull();
  });

  it('regenerates the username from the template field', () => {
    openDialog();
    fireEvent.change(screen.getByLabelText('Username template'), { target: { value: 'camp1*' } });
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Username' }));

    expect(screen.getAllByText(/^camp1[A-Za-z0-9]{8}$/).length).toBeGreaterThan(0);
    expect(screen.queryByText('ada')).toBeNull();
  });
});
