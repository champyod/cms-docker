// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RestoreConflictDialog, conflictActions, regenerateColumn } from '@/components/backup-restore/RestoreConflictDialog';
import type { ConflictChoice } from '@/components/backup-restore/RestoreConflictDialog';
import { detectUniqueConflicts, regenerateSuggestion } from '@/lib/restore-apply';
import type { AccountUsernameConflict, FkOverwriteConflict, RestoreConflict, UniqueIndex } from '@/lib/restore-apply';

const USERNAME_INDEX: UniqueIndex = { table: 'admins', name: 'admins_username_key', columns: ['username'] };
const FILENAME_INDEX: UniqueIndex = { table: 'files', name: 'files_submission_id_filename_key', columns: ['submission_id', 'filename'] };

function uniqueConflict(index: UniqueIndex = USERNAME_INDEX): RestoreConflict {
    const [conflict] = detectUniqueConflicts(index, [{ values: index.columns.map(() => 'shared'), key: ['7'] }], [{ values: index.columns.map(() => 'shared'), key: ['1'] }]);
    return conflict!;
}

const FK_CONFLICT: FkOverwriteConflict = { id: 'fk:contests', kind: 'fk-overwrite', table: 'contests', children: ['participations', 'tasks'] };
const ACCOUNT_CONFLICT: AccountUsernameConflict = {
    id: 'account:admins:username',
    kind: 'account-username',
    table: 'admins',
    index: 'admins_username_key',
    columns: ['username'],
    pair: { username: 'ada', stagedId: 7, liveId: 1 },
};

afterEach(cleanup);

describe('conflictActions', () => {
    it('answers an overwrite-parent conflict by changing what happens to the tables', () => {
        expect(conflictActions(FK_CONFLICT)).toEqual(['merge-table', 'skip-table']);
    });

    it('answers a single-column unique conflict on the archive rows, including a regenerate', () => {
        expect(conflictActions(uniqueConflict())).toEqual(['keep-live', 'take-archive', 'skip-table', 'regenerate']);
    });

    it('offers no regenerate when the uniqueness is spread across several columns', () => {
        expect(conflictActions(uniqueConflict(FILENAME_INDEX))).toEqual(['keep-live', 'take-archive', 'skip-table']);
    });

    it('treats an account username as the single-column unique conflict it is', () => {
        expect(conflictActions(ACCOUNT_CONFLICT)).toEqual(['keep-live', 'take-archive', 'skip-table', 'regenerate']);
    });
});

describe('regenerateColumn', () => {
    it('names the one column a regenerate would replace', () => {
        expect(regenerateColumn(uniqueConflict())).toBe('username');
        expect(regenerateColumn(ACCOUNT_CONFLICT)).toBe('username');
    });

    it('names no column for a composite conflict or an overwrite-parent one', () => {
        expect(regenerateColumn(uniqueConflict(FILENAME_INDEX))).toBeNull();
        expect(regenerateColumn(FK_CONFLICT)).toBeNull();
    });
});

describe('regenerateSuggestion', () => {
    it('mints a fresh uuid for a uuid column', () => {
        expect(regenerateSuggestion('uuid', 'old-id', () => 'NEW-ID')).toBe('NEW-ID');
        expect(regenerateSuggestion('session_uuid', 'old-id', () => 'NEW-ID')).toBe('NEW-ID');
    });

    it('suffixes a username so the new value is readable in the report', () => {
        expect(regenerateSuggestion('username', 'ada', () => 'NEW-ID')).toBe('ada-restored');
    });

    it('suggests nothing for a column it has no rule for', () => {
        expect(regenerateSuggestion('name', 'runner', () => 'NEW-ID')).toBeNull();
        expect(regenerateSuggestion('filename', 'a.ts', () => 'NEW-ID')).toBeNull();
    });
});

describe('the prompt', () => {
    function show(conflict: RestoreConflict | null, onChoose: (choice: ConflictChoice) => void = () => {}): void {
        render(<RestoreConflictDialog conflict={conflict} currentValue="ada" isBusy={false} onChoose={onChoose} onDismiss={() => {}} />);
    }

    it('renders nothing when there is no conflict to resolve', () => {
        show(null);
        expect(screen.queryByText(/Resolve a conflict/)).toBeNull();
    });

    it('offers only the two strategy changes for an overwrite-parent conflict', () => {
        show(FK_CONFLICT);
        expect(screen.getByText('Merge it instead')).toBeDefined();
        expect(screen.getByText('Skip this table')).toBeDefined();
        expect(screen.queryByText('Keep live')).toBeNull();
        expect(screen.queryByText('Take the archive')).toBeNull();
    });

    it('offers the archive-row choices and a prefilled regenerate for a single-column conflict', () => {
        show(uniqueConflict());
        expect(screen.getByText('Keep live')).toBeDefined();
        expect(screen.getByText('Take the archive')).toBeDefined();
        expect(screen.getByText('Skip this table')).toBeDefined();
        expect(screen.getByText('Regenerate the value')).toBeDefined();
        expect(screen.getByPlaceholderText('ada-restored')).toBeDefined();
    });

    it('withholds the regenerate when the uniqueness is composite', () => {
        show(uniqueConflict(FILENAME_INDEX));
        expect(screen.getByText('Keep live')).toBeDefined();
        expect(screen.queryByText('Regenerate the value')).toBeNull();
    });

    it('reports the choice the operator made, and only the choice', async () => {
        const onChoose = vi.fn();
        show(uniqueConflict(), onChoose);
        await userEvent.click(screen.getByText('Keep live'));
        expect(onChoose).toHaveBeenCalledWith({ action: 'keep-live' });
    });

    it('reports a regenerate with the value that was on screen', async () => {
        const onChoose = vi.fn();
        show(uniqueConflict(), onChoose);
        await userEvent.click(screen.getByText('Regenerate the value'));
        expect(onChoose).toHaveBeenCalledWith({ action: 'regenerate', column: 'username', value: 'ada-restored' });
    });
});
