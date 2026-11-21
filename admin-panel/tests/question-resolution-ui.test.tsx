// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { QuestionsPanel, type QuestionRow } from '@/components/contests/contest-communications/QuestionsPanel';
import { useContestCommunications } from '@/components/contests/contest-communications/useContestCommunications';

const mocks = vi.hoisted(() => ({
  getQuestions: vi.fn(),
  getAnnouncements: vi.fn(),
  replyToQuestion: vi.fn(),
  ignoreQuestion: vi.fn(),
  unignoreQuestion: vi.fn(),
  createAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
}));

vi.mock('@/app/actions/questions', () => ({
  getQuestions: mocks.getQuestions,
  replyToQuestion: mocks.replyToQuestion,
  ignoreQuestion: mocks.ignoreQuestion,
  unignoreQuestion: mocks.unignoreQuestion,
}));
vi.mock('@/app/actions/announcements', () => ({
  getAnnouncements: mocks.getAnnouncements,
  createAnnouncement: mocks.createAnnouncement,
  deleteAnnouncement: mocks.deleteAnnouncement,
}));
vi.mock('sonner', () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() } }));

const QUESTION: QuestionRow = {
  id: 9,
  subject: 'Scoring',
  text: 'How is it scored?',
  ignored: false,
  reply_timestamp: null,
  reply_subject: null,
  reply_text: null,
  resolution_kind: null,
  question_timestamp: '2026-01-02T03:04:00Z',
  participations: { users: { username: 'ada' } },
};

/** The same question once answered: the reply block is what carries the classification. */
const ANSWERED: QuestionRow = { ...QUESTION, reply_timestamp: '2026-01-02T04:00:00Z' };

const MARKER_COPY = en.contests.questions;

function noop(): void {
  return undefined;
}

function DictionaryWrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <DictionaryProvider dict={en}>{children}</DictionaryProvider>;
}

function panel(overrides: Partial<React.ComponentProps<typeof QuestionsPanel>>): React.JSX.Element {
  return (
    <DictionaryProvider dict={en}>
      <QuestionsPanel
        questions={[QUESTION]}
        replyingTo={null}
        replySubject=""
        replyText=""
        replySettled={false}
        permissionKeys={['question:answer', 'question:ignore']}
        onReplyingTo={noop}
        onReplySubject={noop}
        onReplyText={noop}
        onReplySettled={noop}
        onReply={noop}
        onIgnore={noop}
        {...overrides}
      />
    </DictionaryProvider>
  );
}

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getQuestions.mockResolvedValue([]);
  mocks.getAnnouncements.mockResolvedValue([]);
  mocks.replyToQuestion.mockResolvedValue({ success: true });
});

/**
 * The operator half of the resolution marker.
 *
 * Why the gate and the render are asserted together: a control that sets the marker is useless if
 * the hook then drops the answer for having no body, and a marker that never reaches the row is
 * invisible to the next reader.
 */
describe('question resolution marker in the panel', () => {
  it('accepts a marker-only answer and records it as settled by the statement', async () => {
    const { result } = renderHook(() => useContestCommunications(4, 3), { wrapper: DictionaryWrapper });
    await waitFor(() => expect(mocks.getAnnouncements).toHaveBeenCalledWith(4));

    act(() => result.current.setReplySettled(true));
    await act(async () => { await result.current.handleReply(9); });

    expect(mocks.replyToQuestion).toHaveBeenCalledWith(9, 3, {
      reply_subject: '',
      reply_text: '',
      resolution_kind: 'settled_by_statement',
    });
  });

  it('still refuses a reply that carries neither a body nor the marker', async () => {
    const { result } = renderHook(() => useContestCommunications(4, 3), { wrapper: DictionaryWrapper });
    await waitFor(() => expect(mocks.getAnnouncements).toHaveBeenCalledWith(4));

    await act(async () => { await result.current.handleReply(9); });

    expect(mocks.replyToQuestion).not.toHaveBeenCalled();
  });

  it('clears the marker once the reply lands, so the next answer is not marked by default', async () => {
    const { result } = renderHook(() => useContestCommunications(4, 3), { wrapper: DictionaryWrapper });
    await waitFor(() => expect(mocks.getAnnouncements).toHaveBeenCalledWith(4));

    act(() => result.current.setReplySettled(true));
    await act(async () => { await result.current.handleReply(9); });

    expect(result.current.replySettled).toBe(false);
  });

  it('offers the marker as a labelled control on the reply form', () => {
    const onReplySettled = vi.fn();
    render(panel({ replyingTo: 9, onReplySettled }));

    fireEvent.click(screen.getByLabelText(MARKER_COPY.settledByStatement));

    expect(onReplySettled).toHaveBeenCalledWith(true);
  });

  it('shows the marker as checked while it is set', () => {
    render(panel({ replyingTo: 9, replySettled: true }));

    expect((screen.getByLabelText(MARKER_COPY.settledByStatement) as HTMLInputElement).checked).toBe(true);
  });

  it('renders the classification beside the answer it marks', () => {
    render(panel({ questions: [{ ...ANSWERED, resolution_kind: 'settled_by_statement' }] }));
    expect(screen.getByText(MARKER_COPY.settledByStatement)).toBeTruthy();
    cleanup();

    render(panel({ questions: [{ ...ANSWERED, resolution_kind: 'clarification_needed' }] }));
    expect(screen.getByText(MARKER_COPY.clarificationNeeded)).toBeTruthy();
  });

  it('claims no classification for an answer written before the marker existed', () => {
    render(panel({ questions: [ANSWERED] }));

    expect(screen.queryByText(MARKER_COPY.settledByStatement)).toBeNull();
    expect(screen.queryByText(MARKER_COPY.clarificationNeeded)).toBeNull();
  });
});
