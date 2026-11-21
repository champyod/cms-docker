'use client';

import { useEffect, useState } from 'react';

import { getPromoteStatus } from '@/app/actions/restore-apply';
import type { PromoteProgressView } from '@/lib/restore-apply-progress';

const PROMOTE_PROGRESS_POLL_MS = 2_000;
/**
 * How long the watcher follows a promote before it stops and says so. The run
 * itself is unaffected: a merge of this size legitimately runs for longer than
 * any page should hold a request open watching it.
 */
export const PROMOTE_PROGRESS_WINDOW_MS = 30 * 60_000;

/** A figure belongs to the report id that published it, so it can never be read against another run. */
interface PromoteWatch {
    readonly runId: string | null;
    readonly progress: PromoteProgressView;
}

/**
 * Reads the applier's per-table figure while a promote runs. It stops when the
 * promote promise settles, because the settled report carries the full detail,
 * and after a bounded window so a long run is never polled forever. `recheck`
 * gives a run that outlasted the window another one, which the operator asks
 * for explicitly because the run itself was never at risk.
 */
export function usePromoteProgress(active: boolean, previewId: string | null, reportId: string | null): { readonly progress: PromoteProgressView; readonly recheck: () => void } {
    const [watch, setWatch] = useState<PromoteWatch>({ runId: null, progress: { state: 'waiting' } });
    const [windowIndex, startWindow] = useState(0);
    useEffect(() => {
        if (!active || previewId === null || reportId === null) return;
        const deadline = Date.now() + PROMOTE_PROGRESS_WINDOW_MS;
        const timer = setInterval(() => {
            if (Date.now() > deadline) {
                clearInterval(timer);
                setWatch({ runId: reportId, progress: { state: 'timeout' } });
                return;
            }
            getPromoteStatus(previewId, reportId).then(
                // A failed read keeps the last figure rather than blanking a promote that is still running.
                (status) => setWatch({ runId: reportId, progress: status }),
                (error: unknown) => console.error(`Could not read promote progress for ${reportId}:`, error),
            );
        }, PROMOTE_PROGRESS_POLL_MS);
        return () => clearInterval(timer);
    }, [active, previewId, reportId, windowIndex]);
    return {
        progress: active && watch.runId === reportId ? watch.progress : { state: 'waiting' },
        recheck: () => {
            setWatch({ runId: reportId, progress: { state: 'waiting' } });
            startWindow((index) => index + 1);
        },
    };
}