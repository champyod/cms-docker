import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PromoteProgressList, PromoteRecords } from '@/components/maintenance/RestorePreviewPanel';
import type { PromoteReport, TableApplyRecord } from '@/lib/restore-apply';
import type { PromotePhase, PromoteProgressView } from '@/lib/restore-apply-progress';

function applied(table: string): TableApplyRecord {
    return { table, strategy: 'merge', status: 'applied', liveBefore: 4, liveAfter: 9, merged: 5 };
}

/** A table whose transaction rolled back: the applier knows it failed, so it reports no figures. */
function failed(table: string): TableApplyRecord {
    return { table, strategy: 'merge', status: 'failed', liveBefore: null, liveAfter: null, merged: null, note: '"users" failed and rolled back' };
}

function reportOf(records: readonly TableApplyRecord[], ok: boolean): PromoteReport {
    const appliedTables = records.filter((record) => record.status === 'applied').map((record) => record.table);
    return {
        ok,
        previewId: 'a'.repeat(32),
        reportId: `restore_staging_${'a'.repeat(32)}-1767225600000`,
        stagingSchema: `restore_staging_${'a'.repeat(32)}`,
        backupEntry: 'full:2026-10-03T01:02:03Z',
        tableRecords: records,
        appliedTables,
        pendingTables: ok ? [] : ['users', 'messages'],
        errors: ok ? [] : ['"users" failed and every later table was left pending'],
        warnings: [],
    };
}

function running(phase: PromotePhase, done: readonly string[]): PromoteProgressView {
    return { state: 'running', phase, doneTables: [...done], totalTables: 3, currentTable: null, updatedAt: '2026-10-03T01:02:03.000Z' };
}

describe('PromoteRecords', () => {
    it('reports the figures a committed table has', () => {
        const html = renderToStaticMarkup(<PromoteRecords report={reportOf([applied('users')], true)} />);
        expect(html).toContain('4 to 9 live rows, 5 written');
        expect(html).not.toContain('not applied');
    });

    it('says a rolled-back table was not applied instead of showing it as zero rows', () => {
        const html = renderToStaticMarkup(<PromoteRecords report={reportOf([applied('contests'), failed('users')], false)} />);
        expect(html).toContain('not applied');
        expect(html).not.toContain('0 to 0 live rows');
        expect(html).toContain('&quot;users&quot; failed and rolled back');
    });

    it('counts a failed run as stopped rather than complete', () => {
        const html = renderToStaticMarkup(<PromoteRecords report={reportOf([applied('contests'), failed('users')], false)} />);
        expect(html).toContain('The run stopped after 1 committed table(s)');
        expect(html).toContain('Pending, never attempted in this run: users, messages');
    });
});

describe('PromoteProgressList', () => {
    it('claims every table is committed only when the figure says so', () => {
        const html = renderToStaticMarkup(<PromoteProgressList progress={running('cleanup', ['a', 'b', 'c'])} onRecheck={() => {}} />);
        expect(html).toContain('Every table is committed.');
    });

    it('withholds that claim when a table did not commit', () => {
        const html = renderToStaticMarkup(<PromoteProgressList progress={running('cleanup', ['a'])} onRecheck={() => {}} />);
        expect(html).toContain('Not every table is committed.');
        expect(html).not.toContain('Every table is committed.');
        expect(html).toContain('1 of 3 table(s) committed.');
    });

    it('leaves the other phases to their own wording', () => {
        const html = renderToStaticMarkup(<PromoteProgressList progress={running('applying', ['a'])} onRecheck={() => {}} />);
        expect(html).toContain('Committing one transaction per table, in foreign-key order.');
    });

    it('renders nothing for a run that is not in flight', () => {
        expect(renderToStaticMarkup(<PromoteProgressList progress={{ state: 'done', updatedAt: '2026-10-03T01:02:03.000Z' }} onRecheck={() => {}} />)).toBe('');
    });
});
