'use client';

import { useEffect, useState } from 'react';

import { getRankingImpact } from '@/app/actions/ranking';
import { RankingImpactDiff } from '@/components/ranking/RankingImpactDiff';
import {
  RankingOverrideForm,
  type RankingOverrideDraft,
  type RankingOverrideKey,
} from '@/components/ranking/RankingOverrideForm';
import type { Dictionary } from '@/lib/dictionary';
import type { RankingImpact } from '@/lib/ranking-impact';

const IMPACT_DEBOUNCE_MS = 300;

export interface RankingOverrideSurfaceProps {
  readonly copy: Dictionary['ranking']['overrides'];
  readonly contestId: number;
  readonly targetKind: string;
  readonly targetKey: string;
  readonly userKeys: readonly RankingOverrideKey[];
  readonly teamKeys: readonly string[];
  readonly contestKeys: readonly RankingOverrideKey[];
  readonly taskKeys: readonly RankingOverrideKey[];
}

interface ImpactRead {
  readonly impact: RankingImpact | null;
  readonly loading: boolean;
  readonly failed: boolean;
}

interface ImpactAnswer {
  readonly request: string;
  readonly impact: RankingImpact | null;
  readonly failed: boolean;
}

const IDLE: ImpactRead = { impact: null, loading: false, failed: false };

function requestKey(contestId: number, draft: RankingOverrideDraft): string {
  return draft.targetKey.trim() === '' ? '' : `${contestId}:${draft.targetKind}:${draft.targetKey}`;
}

/**
 * The pending row's board impact, re-read once the draft settles.
 *
 * WHY the debounce: without it every keystroke and every picker change starts a projection read,
 * and the read only means something once the target has stopped moving. WHY the pending flag is
 * derived and not written: an answer names the request it answers, so a read is outstanding
 * exactly while the last answer names a different request, and no effect has to synchronise that.
 * WHY a failure is reported and not swallowed: a projection read that fell over looks identical to
 * a target that changes nothing, and the two call for different responses.
 */
function useImpactRead(contestId: number, draft: RankingOverrideDraft): ImpactRead {
  const { targetKind, targetKey } = draft;
  const request = requestKey(contestId, draft);
  const [answer, setAnswer] = useState<ImpactAnswer>({ request: '', impact: null, failed: false });

  useEffect(() => {
    if (request === '') return;
    let live = true;
    const timer = setTimeout(() => {
      getRankingImpact(contestId, targetKind, targetKey)
        .then((impact) => {
          if (live) setAnswer({ request, impact, failed: false });
        })
        .catch(() => {
          if (live) setAnswer({ request, impact: null, failed: true });
        });
    }, IMPACT_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [request, contestId, targetKind, targetKey]);

  if (request === '') return IDLE;
  if (answer.request !== request) return { impact: null, loading: true, failed: false };
  return { impact: answer.impact, loading: false, failed: answer.failed };
}

/**
 * Shape V2: the kind chooser and its form pinned as the toolbar with the impact diff as a live
 * column beside it, so the operator sees what a row would drop at the moment they compose it.
 * The list below the pair is its own surface; this component owns the toolbar and the diff.
 */
export function RankingOverrideSurface(props: RankingOverrideSurfaceProps): React.JSX.Element {
  const [draft, setDraft] = useState<RankingOverrideDraft>({
    targetKind: props.targetKind,
    targetKey: props.targetKey,
  });
  const read = useImpactRead(props.contestId, draft);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <RankingOverrideForm
        copy={props.copy}
        contestId={String(props.contestId)}
        targetKind={props.targetKind}
        targetKey={props.targetKey}
        userKeys={props.userKeys}
        teamKeys={props.teamKeys}
        contestKeys={props.contestKeys}
        taskKeys={props.taskKeys}
        onDraftChange={setDraft}
      />
      <RankingImpactDiff copy={props.copy} impact={read.impact} loading={read.loading} failed={read.failed} />
    </div>
  );
}
