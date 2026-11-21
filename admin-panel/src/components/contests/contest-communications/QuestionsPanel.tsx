'use client';

import { Eye, EyeOff, Reply } from 'lucide-react';
import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { RowActions, rowActionGroupLabel, type RowAction } from '@/components/core/RowActions';
import { useDictionary } from '@/hooks/useDictionary';
import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import { ACTION_PERMISSIONS } from '@/lib/permission-engine';
import type { Dictionary } from '@/lib/dictionary';
import type { QuestionResolutionKind } from '@/app/actions/questions';

export interface QuestionRow {
  id: number;
  subject: string;
  text: string;
  ignored: boolean;
  reply_timestamp: string | Date | null;
  reply_subject: string | null;
  reply_text: string | null;
  // Why optional: every row written before the column existed carries no marker, and an
  // invented classification states something the record never recorded.
  resolution_kind?: QuestionResolutionKind | null;
  question_timestamp: string | Date;
  participations?: { users?: { username: string } } | null;
}

interface Props {
  questions: QuestionRow[];
  replyingTo: number | null;
  replySubject: string;
  replyText: string;
  replySettled: boolean;
  permissionKeys: readonly string[];
  onReplyingTo: (id: number | null) => void;
  onReplySubject: (v: string) => void;
  onReplyText: (v: string) => void;
  onReplySettled: (v: boolean) => void;
  onReply: (id: number) => void;
  onIgnore: (id: number, ignored: boolean) => void;
}

const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

interface QuestionGates {
  readonly showReply: boolean;
}

function buildQuestionActions(
  question: QuestionRow,
  gates: QuestionGates,
  replyingTo: number | null,
  onReplyingTo: (id: number | null) => void,
  onIgnore: (id: number, ignored: boolean) => void,
): RowAction[] {
  const ignorePermission = question.ignored ? ACTION_PERMISSIONS.unignoreQuestion : ACTION_PERMISSIONS.ignoreQuestion;
  return [
    { key: 'reply', label: 'Reply', ariaLabel: `Reply to ${question.subject}`, icon: Reply, onClick: () => onReplyingTo(replyingTo === question.id ? null : question.id), permission: ACTION_PERMISSIONS.replyToQuestion, showWhen: gates.showReply, className: 'shrink-0 rounded-lg text-primary hover:bg-primary/20' },
    { key: 'ignore', label: question.ignored ? 'Unignore' : 'Ignore', ariaLabel: question.ignored ? 'Unignore question' : 'Ignore question', icon: question.ignored ? Eye : EyeOff, onClick: () => onIgnore(question.id, question.ignored), permission: ignorePermission, className: 'shrink-0 rounded-lg' },
  ];
}

/**
 * The classification the operator chose, shown beside the answer it was chosen for.
 *
 * Why an absent marker renders as nothing: a question answered before the column existed carries
 * none, and a default badge would report a decision nobody made.
 */
function ResolutionBadge({ kind, dict }: { kind: QuestionResolutionKind | null | undefined; dict: Dictionary }): React.JSX.Element | null {
  if (kind === 'settled_by_statement') return <Badge variant="success">{dict.contests.questions.settledByStatement}</Badge>;
  if (kind === 'clarification_needed') return <Badge variant="info">{dict.contests.questions.clarificationNeeded}</Badge>;
  return null;
}

export function QuestionsPanel({ questions, replyingTo, replySubject, replyText, replySettled, permissionKeys, onReplyingTo, onReplySubject, onReplyText, onReplySettled, onReply, onIgnore }: Props): React.JSX.Element {
  const dict = useDictionary();
  // Why the contest zone: a question is asked against one contest's schedule, so its wall clock is
  // the contest's own, whatever zone the staff member reading it happens to sit in.
  const formatTime = useFormatTimestamp();
  if (questions.length === 0) return <p className="text-sm text-muted-foreground">No questions from contestants.</p>;
  return (
    <div className="space-y-3">
      {questions.map((q) => (
        <div key={q.id} className={`rounded-lg p-3 ${q.ignored ? 'bg-muted/50' : 'bg-muted/30'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{q.subject}</span>
                {q.ignored && <span className="text-xs text-muted-foreground">(Ignored)</span>}
                {q.reply_timestamp && <span className="text-xs text-success">(Replied)</span>}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{q.text}</div>
              <div className="mt-2 text-xs text-muted-foreground">From: {q.participations?.users?.username} at {formatTime(q.question_timestamp)}</div>
              {q.reply_timestamp && (
                <div className="mt-3 rounded-lg border-l-2 border-primary bg-primary/10 p-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-primary">{q.reply_subject}</div>
                    <ResolutionBadge kind={q.resolution_kind} dict={dict} />
                  </div>
                  <div className="text-sm text-muted-foreground">{q.reply_text}</div>
                </div>
              )}
            </div>
            <RowActions
              ariaLabel={rowActionGroupLabel(dict, 'questions')}
              className="shrink-0"
              permissionKeys={permissionKeys}
              actions={buildQuestionActions(q, { showReply: q.reply_timestamp === null }, replyingTo, onReplyingTo, onIgnore)}
            />
          </div>
          {replyingTo === q.id && (
            <div className="mt-3 space-y-2 rounded-lg bg-muted/30 p-3">
              <input type="text" value={replySubject} onChange={(e) => onReplySubject(e.target.value)} placeholder="Reply subject" className={FIELD_CLASSES} />
              <textarea value={replyText} onChange={(e) => onReplyText(e.target.value)} placeholder="Reply message..." rows={2} className={FIELD_CLASSES} />
              {/* Why a marker control of its own: the statement alone can settle a question, and the
                  operator has to say so — an empty body is that answer, not a missing one. */}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={replySettled} onChange={(e) => onReplySettled(e.target.checked)} className="rounded border-input bg-card accent-primary" />
                {dict.contests.questions.settledByStatement}
              </label>
              <Button size="sm" variant="positive" onClick={() => onReply(q.id)}>Send Reply</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
