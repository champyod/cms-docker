import { notFound } from 'next/navigation';
import { DetailSurface } from '@/components/core/DetailSurface';
import type { SurfaceStatus } from '@/components/core/SurfaceState';
import { SubmissionActionBar } from '@/components/submissions/SubmissionActionBar';
import { SubmissionQueuedBanner } from '@/components/submissions/SubmissionQueuedBanner';
import { SubmissionRecordLiveRefresh } from '@/components/submissions/SubmissionRecordLiveRefresh';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { getSubmissionJudgingState } from '@/lib/evaluation-read-model-judging-state';
import { getPreviousSubmission, getSubmissionSummary } from '@/lib/evaluation-read-models';
import type { SubmissionJudgingState, SubmissionSummary } from '@/lib/evaluation-read-model-types';
import { judgingPhaseLabelKey, type JudgingPhaseLabelKey } from '@/lib/evaluation-read-model-judging';
import { interpolate } from '@/lib/interpolate';
import { recordBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteDescriptor, RouteId, RouteTab } from '@/lib/navigation/types';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

import { SubmissionRecordLinks } from './header-links';

const RECORD_ACTION_ENTRIES = ['recompute', 'download', 'comment', 'official', 'lane'] as const;

// Mirrors the gate readSubmissionCapabilities resolves for canRecompute; declared here because the projections module keeps it private and the server action remains the authority.
const RECOMPUTE_GATE_KEYS = [
  'submission:recompute',
  'submission:rejudge',
  'evaluation:delete',
  'submissionresult:delete',
] as const;

// Why only a partial grant: a reader holding none of the group's keys is simply not a recompute reader, while a reader holding some of them would otherwise lose the controls with no explanation.
function missingRecomputeKeys(effective: ReadonlySet<string>): readonly string[] | undefined {
  const missing = RECOMPUTE_GATE_KEYS.filter((key) => !hasEffectivePermission(effective, key));
  return missing.length > 0 && missing.length < RECOMPUTE_GATE_KEYS.length ? missing : undefined;
}

function labelForKey(dictionary: Dictionary, key: string): string {
  const label = key.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return Reflect.get(value, segment);
  }, dictionary);
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error(`Missing navigation label: ${key}`);
  }
  return label;
}

function labelForDescriptor(dictionary: Dictionary, descriptor: RouteDescriptor): string {
  return labelForKey(dictionary, descriptor.labelKey);
}

function findRoute(routeId: RouteId): RouteDescriptor {
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
  if (!route) notFound();
  return route;
}

// Why the task leads: a submission has no name of its own, and the task it was
// sent for is what a reader recognises; the submitter is the next identifier down.
// A row whose task and submitter the caller may not read falls back to the id,
// which is the one value this page can always show.
export function submissionHeading(summary: SubmissionSummary): string {
  return summary.task?.name ?? `#${summary.id}`;
}

// Why the handle behind the name: a reader without the name columns, or a user stored without one, still gets the username.
export function submissionDescription(summary: SubmissionSummary): string | null {
  const user = summary.user;
  if (!user) return summary.language ?? null;
  const fullName = [user.firstName, user.lastName]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ');
  return fullName === '' ? user.username : `${fullName} · ${user.username}`;
}

export type SubmissionStatusLabels = Record<JudgingPhaseLabelKey, string> & {
  readonly official: string;
  readonly points: string;
};

// Why per segment: each of score, phase, and official flag is omitted rather than guessed when unreadable.
export function submissionStatus(
  judging: SubmissionJudgingState | null,
  official: boolean,
  labels: SubmissionStatusLabels,
): SurfaceStatus | undefined {
  const segments: string[] = [];
  if (judging !== null && judging.totalScore !== null) {
    segments.push(interpolate(labels.points, { score: judging.totalScore.toFixed(1) }));
  }
  if (judging !== null) segments.push(labels[judgingPhaseLabelKey(judging.phase)]);
  if (official) segments.push(labels.official);
  return segments.length === 0 ? undefined : { kind: 'info', title: segments.join(' · ') };
}

function statusLabelsFor(dictionary: Dictionary): SubmissionStatusLabels {
  const status = dictionary.submissions.record.status;
  return {
    judging: status.judging,
    compiling: status.compiling,
    compilationFailed: status.compilationFailed,
    evaluating: status.evaluating,
    scoring: status.scoring,
    done: status.done,
    official: status.official,
    points: status.points,
  };
}

// Why: a tab the reader may not open is omitted entirely rather than rendered
// disabled, so the record rail never advertises a route that would 404.
export function buildSubmissionTabs(
  locale: string,
  submissionId: number,
  effective: ReadonlySet<string>,
  dictionary: Dictionary,
): readonly RouteTab[] {
  const record = findRoute('evaluation.submission-record');
  if (!record.enabled || !isRoutePermitted(record, effective)) notFound();
  return record.tabIds.flatMap((routeId: RouteId) => {
    const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
    if (!route || !route.enabled || !isRoutePermitted(route, effective)) return [];
    return [{
      id: route.id,
      label: labelForDescriptor(dictionary, route),
      href: buildRoute(locale, route.id, { id: submissionId }),
    } satisfies RouteTab];
  });
}

function isListPermitted(effective: ReadonlySet<string>): boolean {
  const descriptor = ROUTE_REGISTRY.find((route) => route.id === 'evaluation.submissions');
  return descriptor !== undefined && descriptor.enabled && isRoutePermitted(descriptor, effective);
}

// Why: the summary read is what proves the record exists and that the caller may
// open it, so a missing row and a 403 both render as the concealed not-found
// view while a 401 or an unexpected failure keeps propagating.
async function loadSubmissionRecord(submissionId: number): Promise<{
  readonly effective: ReadonlySet<string>;
  readonly summary: SubmissionSummary;
}> {
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('submission:read');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  return { effective, summary: await readRecordOrNotFound(() => getSubmissionSummary(submissionId)) };
}

// Why null instead of a guessed pill: a reader without the outcome column key gets no fabricated "Judging…".
async function loadJudgingState(
  submissionId: number,
  effective: ReadonlySet<string>,
): Promise<SubmissionJudgingState | null> {
  if (!hasEffectivePermission(effective, 'submissionresult:read')) return null;
  return getSubmissionJudgingState(submissionId);
}

function buildDescription(
  summary: SubmissionSummary,
  locale: string,
  canListSubmissions: boolean,
  previousId: number | undefined,
): React.ReactNode {
  const identity = submissionDescription(summary);
  const hasRelations = summary.user !== null || summary.task !== null || summary.contest !== null;
  // Why the previous chip counts: a submission whose relations this reader may not
  // read still has a comparison worth reaching, so the chip alone keeps the header.
  if (identity === null && !hasRelations && previousId === undefined) return undefined;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {identity && <span>{identity}</span>}
      <SubmissionRecordLinks
        summary={summary}
        locale={locale}
        canListSubmissions={canListSubmissions}
        previousId={previousId}
      />
    </span>
  );
}

export default async function SubmissionRecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const dictionary = await getDictionary(locale);
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  const { effective, summary } = await loadSubmissionRecord(id);
  const [judging, previous] = await Promise.all([
    loadJudgingState(id, effective),
    getPreviousSubmission(id),
  ]);
  return (
    <DetailSurface
      breadcrumbs={recordBreadcrumbs(locale, 'evaluation', 'evaluation.submission-record', 'evaluation.submissions', dictionary)}
      title={submissionHeading(summary)}
      description={buildDescription(summary, locale, isListPermitted(effective), previous?.submissionId)}
      status={submissionStatus(judging, summary.official, statusLabelsFor(dictionary))}
      tabs={buildSubmissionTabs(locale, id, effective, dictionary)}
      actions={
        <>
          <SubmissionRecordLiveRefresh url={`/api/submissions/${id}/stream`} />
          <SubmissionActionBar
            submissionId={id}
            capabilities={summary.capabilities}
            comment={summary.comment}
            official={summary.official}
            entries={RECORD_ACTION_ENTRIES}
            taskId={summary.task?.id ?? null}
            lockHintKeys={missingRecomputeKeys(effective)}
          />
        </>
      }
    >
      <SubmissionQueuedBanner />
      {children}
    </DetailSurface>
  );
}
