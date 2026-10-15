import { describe, expect, it } from 'vitest';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';

// Why: the submission redesign is split across three workstreams that all read
// these keys from the dictionary rather than owning literals, so a key that is
// missing in one locale renders blank copy in that locale at runtime.

type Dictionary = typeof en;

const REQUIRED_KEYS: readonly string[] = [
  'submissions.filters.search',
  'submissions.filters.searchPlaceholder',
  'submissions.filters.contest',
  'submissions.filters.task',
  'submissions.filters.user',
  'submissions.filters.any',
  'submissions.filters.apply',
  'submissions.filters.clear',
  'submissions.filters.more',
  'submissions.filters.searching',
  'submissions.filters.noMatches',
  'submissions.filters.loadFailed',
  'submissions.bulk.rescore',
  'submissions.bulk.reevaluate',
  'submissions.bulk.full',
  'submissions.bulk.official',
  'submissions.bulk.applyToFilter',
  'submissions.actions.rescore',
  'submissions.actions.reevaluate',
  'submissions.actions.fullRerun',
  'submissions.actions.downloadFiles',
  'submissions.actions.editComment',
  'submissions.actions.markOfficial',
  'submissions.actions.clearOfficial',
  'submissions.actions.moveLane',
  'submissions.actions.moreActions',
  'submissions.status.done',
  'submissions.status.compiling',
  'submissions.status.compilationFailed',
  'submissions.status.evaluating',
  'submissions.status.scoring',
  'submissions.status.judging',
  'submissions.toasts.commentPending',
  'submissions.toasts.commentSuccess',
  'submissions.toasts.commentFailure',
  'submissions.toasts.officialPending',
  'submissions.toasts.officialSuccess',
  'submissions.toasts.officialFailure',
  'submissions.toasts.recomputePending',
  'submissions.toasts.recomputeSuccess',
  'submissions.toasts.recomputeFailure',
  'submissions.toasts.downloadPending',
  'submissions.toasts.downloadSuccess',
  'submissions.toasts.downloadFailure',
  'submissions.history.label',
  'submissions.history.empty',
  'submissions.queued.title',
  'submissions.queued.banner',
  'submissions.retry.title',
  'submissions.retry.description',
  'submissions.retry.action',
  'submissions.lockHint',
  'submissions.record.actions.rescore',
  'submissions.record.actions.reEvaluate',
  'submissions.record.actions.fullRerun',
  'submissions.record.actions.rerun',
  'submissions.record.actions.downloadFiles',
  'submissions.record.actions.editComment',
  'submissions.record.actions.moveLane',
  'submissions.record.official.mark',
  'submissions.record.official.clear',
  'submissions.record.toolbarLabel',
  'submissions.record.rerunTyped.confirm',
  'submissions.record.comment.save',
  'submissions.record.comment.toasts.pending',
  'submissions.record.comment.toasts.saved',
  'submissions.record.comment.toasts.failed',
  'submissions.record.toasts.officialPending',
  'submissions.record.toasts.recomputeQueued',
  'submissions.record.toasts.downloadEmpty',
  'submissions.record.source.download',
  'submissions.record.source.copy',
  'submissions.record.source.wrap',
  'submissions.record.status.judging',
  'submissions.record.status.compiling',
  'submissions.record.status.compilationFailed',
  'submissions.record.status.evaluating',
  'submissions.record.status.scoring',
  'submissions.record.status.done',
  'submissions.record.status.official',
  'submissions.record.status.points',
  'submissions.record.links.allByUser',
  'submissions.record.links.allForTask',
  'submissions.record.links.allForContest',
  'submissions.queued.bannerAt',
  'submissions.notify.scored',
  'submissions.notify.compilationFailed',
  'submissions.notify.batchTitle',
  'submissions.notify.batchDetail',
  'submissions.record.official.revert',
  'submissions.record.official.on',
  'submissions.record.official.off',
  'submissions.record.identity.time',
  'submissions.record.identity.language',
  'submissions.record.outcome.compilation',
  'submissions.record.outcome.evaluation',
  'submissions.record.outcome.open',
  'submissions.record.outcome.unreadable',
  'submissions.record.results.emptyTitle',
  'submissions.record.results.emptyDescription',
  'submissions.record.results.dataset',
  'submissions.record.results.pending',
  'submissions.record.results.compilationSkipped',
  'submissions.record.results.evaluationSkipped',
  'submissions.record.results.stats.time',
  'submissions.record.results.stats.memory',
  'submissions.record.results.stats.public',
  'submissions.record.results.stats.scored',
  'submissions.record.logs.emptyTitle',
  'submissions.record.logs.emptyDescription',
  'submissions.record.logs.title',
  'submissions.record.recompute.datasetLabel',
  'submissions.record.recompute.activeDefault',
  'submissions.record.history.actor',
  'submissions.record.history.action',
  'submissions.record.history.reason',
  'submissions.record.history.result',
  'submissions.record.history.timestamp',
  'submissions.record.lane.description',
  'confirmations.recalculate.descriptionDataset',
  'navigation.evaluation.submission-tabs.history.label',
  'states.loading.submissionHistory',
];

const DICTIONARIES: readonly (readonly [string, Dictionary])[] = [
  ['en', en],
  ['th', th],
];

function readPath(dictionary: Dictionary, path: string): unknown {
  let current: unknown = dictionary;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = Reflect.get(current, segment);
  }
  return current;
}

function placeholderSet(value: string): string[] {
  return [...value.matchAll(/\{[^}]+\}/g)].map((match) => match[0]).sort();
}

function subtreeEntries(dictionary: Dictionary): [string, string][] {
  const entries: [string, string][] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      entries.push([path, value]);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [key, child] of Object.entries(value)) walk(child, path === '' ? key : `${path}.${key}`);
    }
  };
  walk(dictionary.submissions, 'submissions');
  return entries;
}

describe('submission dictionary keys', () => {
  it('has a non-empty value in every locale for every required key', () => {
    for (const key of REQUIRED_KEYS) {
      for (const [locale, dictionary] of DICTIONARIES) {
        const value = readPath(dictionary, key);
        expect(typeof value, `${locale} ${key}`).toBe('string');
        expect(String(value).trim(), `${locale} ${key}`).not.toBe('');
      }
    }
  });

  it('keeps the interpolation placeholders identical between locales', () => {
    const enEntries = new Map(subtreeEntries(en));
    for (const [path, thValue] of subtreeEntries(th)) {
      const enValue = enEntries.get(path);
      expect(enValue, path).toBeDefined();
      expect(placeholderSet(thValue), path).toEqual(placeholderSet(enValue as string));
    }
  });

  it('carries {keys} on the read-only lock hint both locales', () => {
    expect((en.submissions as unknown as Record<string, string>).lockHint).toContain('{keys}');
    expect((th.submissions as unknown as Record<string, string>).lockHint).toContain('{keys}');
  });
});
