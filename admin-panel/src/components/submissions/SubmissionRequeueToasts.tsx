'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

import { useDictionary } from '@/hooks/useDictionary';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import type { SubmissionListItem } from '@/types';

import { submissionTerminalState } from './submissionColumns';

export const REQUEUE_WATCH_KEY = 'cms:requeue-watch:submissions';

const WATCH_LIMIT = 500;
const WATCH_TTL_MS = 24 * 60 * 60 * 1000;

interface WatchedRequeue {
  readonly id: number;
  readonly queuedAt: number;
}

function readWatch(): readonly WatchedRequeue[] {
  try {
    const raw = window.sessionStorage.getItem(REQUEUE_WATCH_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - WATCH_TTL_MS;
    return parsed
      .filter((entry): entry is WatchedRequeue => {
        if (typeof entry !== 'object' || entry === null) return false;
        const watched = entry as WatchedRequeue;
        return typeof watched.id === 'number' && typeof watched.queuedAt === 'number' && watched.queuedAt >= cutoff;
      })
      .slice(-WATCH_LIMIT);
  } catch {
    return [];
  }
}

function writeWatch(entries: readonly WatchedRequeue[]): void {
  try {
    window.sessionStorage.setItem(REQUEUE_WATCH_KEY, JSON.stringify(entries));
  } catch {
    // A full or disabled session store costs the reader their completion toasts, which is recoverable.
  }
}

/**
 * Remembers the submissions this browser just requeued, so their arrival at a
 * terminal state can be announced when the live-refreshed rows show it.
 */
export function watchSubmissionsForCompletion(ids: readonly number[]): void {
  if (ids.length === 0) return;
  const queuedAt = Date.now();
  const watched = new Map(readWatch().map((entry) => [entry.id, entry]));
  for (const id of ids) watched.set(id, { id, queuedAt });
  writeWatch([...watched.values()].slice(-WATCH_LIMIT));
}

interface Completion {
  readonly id: number;
  readonly state: 'scored' | 'failed';
  readonly score: number | null;
}

function completionLine(dict: Dictionary, completion: Completion): string {
  const copy = dict.submissions.notify;
  if (completion.state === 'failed') return interpolate(copy.compilationFailed, { id: completion.id });
  return interpolate(copy.scored, { id: completion.id, score: (completion.score ?? 0).toFixed(0) });
}

function announceCompletions(dict: Dictionary, completions: readonly Completion[]): void {
  const copy = dict.submissions.notify;
  if (completions.length === 1) {
    const only = completions[0];
    const options = { id: `submission-requeue-${only.id}` };
    if (only.state === 'failed') toast.warning(completionLine(dict, only), options);
    else toast.success(completionLine(dict, only), options);
    return;
  }
  toast.success(copy.batchTitle, {
    id: 'submission-requeue-batch',
    description: interpolate(copy.batchDetail, {
      first: completionLine(dict, completions[0]),
      count: completions.length - 1,
    }),
  });
}

/**
 * Announces requeued submissions reaching a terminal state.
 *
 * Why here and not in the stream: the list's cursor only says its data moved — the rows themselves
 * are what know a submission finished, and the reader's own refreshed page already carries them, so
 * this watcher makes no query of its own and can only ever report rows the reader may already see.
 * Each watched id is announced once and then forgotten, and a wide batch collapses into one summary
 * so a mass requeue cannot flood the toaster.
 */
export function SubmissionRequeueToasts({ submissions }: { readonly submissions: readonly SubmissionListItem[] }): null {
  const dict = useDictionary();

  useEffect(() => {
    const watched = readWatch();
    if (watched.length === 0) return;
    const rows = new Map(submissions.map((submission) => [submission.id, submission]));
    const completions: Completion[] = [];
    for (const entry of watched) {
      const row = rows.get(entry.id);
      if (row === undefined) continue;
      const state = submissionTerminalState(row);
      if (state === null) continue;
      completions.push({ id: entry.id, state, score: row.submission_results[0]?.score ?? null });
    }
    if (completions.length === 0) return;
    const announced = new Set(completions.map((completion) => completion.id));
    writeWatch(watched.filter((entry) => !announced.has(entry.id)));
    announceCompletions(dict, completions);
  }, [submissions, dict]);

  return null;
}
