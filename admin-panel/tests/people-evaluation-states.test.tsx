// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import PeopleLoading from '@/app/[locale]/(authenticated)/people/loading';
import PeopleError from '@/app/[locale]/(authenticated)/people/error';
import PeopleNotFound from '@/app/[locale]/(authenticated)/people/not-found';
import UserProfileLoading from '@/app/[locale]/(authenticated)/people/users/[id]/profile/loading';
import UserProfileError from '@/app/[locale]/(authenticated)/people/users/[id]/profile/error';
import UserTeamsLoading from '@/app/[locale]/(authenticated)/people/users/[id]/teams/loading';
import UserTeamsError from '@/app/[locale]/(authenticated)/people/users/[id]/teams/error';
import UserHistoryLoading from '@/app/[locale]/(authenticated)/people/users/[id]/history/loading';
import UserHistoryError from '@/app/[locale]/(authenticated)/people/users/[id]/history/error';
import UserRecordNotFound from '@/app/[locale]/(authenticated)/people/users/[id]/not-found';
import TeamOverviewLoading from '@/app/[locale]/(authenticated)/people/teams/[id]/overview/loading';
import TeamOverviewError from '@/app/[locale]/(authenticated)/people/teams/[id]/overview/error';
import TeamMembersLoading from '@/app/[locale]/(authenticated)/people/teams/[id]/members/loading';
import TeamMembersError from '@/app/[locale]/(authenticated)/people/teams/[id]/members/error';
import TeamContestsLoading from '@/app/[locale]/(authenticated)/people/teams/[id]/contests/loading';
import TeamContestsError from '@/app/[locale]/(authenticated)/people/teams/[id]/contests/error';
import TeamRecordNotFound from '@/app/[locale]/(authenticated)/people/teams/[id]/not-found';
import EvaluationLoading from '@/app/[locale]/(authenticated)/evaluation/loading';
import EvaluationError from '@/app/[locale]/(authenticated)/evaluation/error';
import EvaluationNotFound from '@/app/[locale]/(authenticated)/evaluation/not-found';
import SubmissionSummaryLoading from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/summary/loading';
import SubmissionSummaryError from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/summary/error';
import SubmissionResultsLoading from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/results/loading';
import SubmissionResultsError from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/results/error';
import SubmissionLogsLoading from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/logs/loading';
import SubmissionLogsError from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/logs/error';
import SubmissionEvaluationLoading from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/evaluation/loading';
import SubmissionEvaluationError from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/evaluation/error';
import SubmissionRecordNotFound from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/not-found';

afterEach(() => cleanup());

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/people/users/17/history',
}));

interface LoadingBoundary {
  readonly Component: () => ReactElement;
  readonly text: string;
}

interface ErrorBoundary {
  readonly Component: (props: { error: Error & { digest?: string }; reset: () => void }) => ReactElement;
  readonly text: string;
}

interface NotFoundBoundary {
  readonly Component: () => ReactElement;
  readonly text: string;
}

const LOADING_BOUNDARIES: readonly LoadingBoundary[] = [
  { Component: PeopleLoading, text: en.states.loading.people },
  { Component: UserProfileLoading, text: en.states.loading.userProfile },
  { Component: UserTeamsLoading, text: en.states.loading.userTeams },
  { Component: UserHistoryLoading, text: en.states.loading.userHistory },
  { Component: TeamOverviewLoading, text: en.states.loading.teamOverview },
  { Component: TeamMembersLoading, text: en.states.loading.teamMembers },
  { Component: TeamContestsLoading, text: en.states.loading.teamContests },
  { Component: EvaluationLoading, text: en.states.loading.evaluation },
  { Component: SubmissionSummaryLoading, text: en.states.loading.submissionSummary },
  { Component: SubmissionResultsLoading, text: en.states.loading.submissionResults },
  { Component: SubmissionLogsLoading, text: en.states.loading.submissionLogs },
  { Component: SubmissionEvaluationLoading, text: en.states.loading.submissionEvaluation },
];

const ERROR_BOUNDARIES: readonly ErrorBoundary[] = [
  { Component: PeopleError, text: en.states.error.people },
  { Component: UserProfileError, text: en.states.error.userRecord },
  { Component: UserTeamsError, text: en.states.error.userRecord },
  { Component: UserHistoryError, text: en.states.error.userRecord },
  { Component: TeamOverviewError, text: en.states.error.teamRecord },
  { Component: TeamMembersError, text: en.states.error.teamRecord },
  { Component: TeamContestsError, text: en.states.error.teamRecord },
  { Component: EvaluationError, text: en.states.error.evaluation },
  { Component: SubmissionSummaryError, text: en.states.error.submissionRecord },
  { Component: SubmissionResultsError, text: en.states.error.submissionRecord },
  { Component: SubmissionLogsError, text: en.states.error.submissionRecord },
  { Component: SubmissionEvaluationError, text: en.states.error.submissionRecord },
];

const NOT_FOUND_BOUNDARIES: readonly NotFoundBoundary[] = [
  { Component: PeopleNotFound, text: '' },
  { Component: UserRecordNotFound, text: '' },
  { Component: TeamRecordNotFound, text: '' },
  { Component: EvaluationNotFound, text: '' },
  { Component: SubmissionRecordNotFound, text: '' },
];

function renderBoundary(node: ReactElement): HTMLElement {
  const { container } = render(<DictionaryProvider dict={en}>{node}</DictionaryProvider>);
  return container;
}

describe('People and Evaluation loading boundaries', () => {
  it.each(LOADING_BOUNDARIES)('renders the shared busy state with its own copy', ({ Component, text }) => {
    const container = renderBoundary(<Component />);

    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain(text);
  });
});

describe('People and Evaluation error boundaries', () => {
  it.each(ERROR_BOUNDARIES)('offers a retry action instead of the thrown exception', ({ Component }) => {
    const reset = vi.fn();
    const failure = new Error('PGPASSWORD is not set on the read replica');
    const container = renderBoundary(<Component error={failure} reset={reset} />);

    expect(container.textContent).toContain(en.states.retry.label);
    expect(container.textContent).toContain(en.states.retry.description);
    expect(document.body.textContent).not.toContain(failure.message);
    // Why: a permission failure reaches this boundary as a 403-shaped error, so
    // the rendered copy must not name a permission or an authorization failure.
    expect(document.body.textContent?.toLowerCase()).not.toContain('permission');

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('People and Evaluation not-found boundaries', () => {
  it.each(NOT_FOUND_BOUNDARIES)('renders one generic view that names no cause', ({ Component }) => {
    const container = renderBoundary(<Component />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('Page Not Found');
    // Why: a denied read renders this same view, so the copy must not name an
    // authorization failure or a permission that the caller lacks.
    expect(text.toLowerCase()).not.toContain('permission');
    expect(text.toLowerCase()).not.toContain('forbidden');
    expect(text.toLowerCase()).not.toContain('unauthorized');
    expect(container.querySelector('a[href]')).not.toBeNull();
  });

  it('gives a missing entity and a missing permission the identical view', () => {
    const first = renderBoundary(<PeopleNotFound />);
    const firstHtml = first.innerHTML;
    cleanup();
    const second = renderBoundary(<UserRecordNotFound />);

    expect(second.innerHTML).toBe(firstHtml);
  });
});
