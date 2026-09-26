'use client';

import { Eye, EyeOff, Reply } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { RowActions, rowActionGroupLabel, type RowAction } from '@/components/core/RowActions';
import { useDictionary } from '@/hooks/useDictionary';

export interface QuestionRow {
  id: number;
  subject: string;
  text: string;
  ignored: boolean;
  reply_timestamp: string | Date | null;
  reply_subject: string | null;
  reply_text: string | null;
  question_timestamp: string | Date;
  participations?: { users?: { username: string } } | null;
}

interface Props {
  questions: QuestionRow[];
  replyingTo: number | null;
  replySubject: string;
  replyText: string;
  canReply?: boolean;
  canIgnore?: boolean;
  onReplyingTo: (id: number | null) => void;
  onReplySubject: (v: string) => void;
  onReplyText: (v: string) => void;
  onReply: (id: number) => void;
  onIgnore: (id: number, ignored: boolean) => void;
}

const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

// Why module scope: every question row formats its own timestamp, so a per-row
// formatter would be rebuilt for each card on every render.
const QUESTION_TIME_FORMAT = new Intl.DateTimeFormat();

function formatTime(date: Date | string): string {
  return QUESTION_TIME_FORMAT.format(new Date(date));
}

interface QuestionGates {
  readonly canReply: boolean;
  readonly canIgnore: boolean;
}

function buildQuestionActions(
  question: QuestionRow,
  gates: QuestionGates,
  replyingTo: number | null,
  onReplyingTo: (id: number | null) => void,
  onIgnore: (id: number, ignored: boolean) => void,
): RowAction[] {
  return [
    { key: 'reply', label: 'Reply', ariaLabel: `Reply to ${question.subject}`, icon: Reply, onClick: () => onReplyingTo(replyingTo === question.id ? null : question.id), isVisible: gates.canReply && !question.reply_timestamp, className: 'shrink-0 rounded-lg text-primary hover:bg-primary/20' },
    { key: 'ignore', label: question.ignored ? 'Unignore' : 'Ignore', ariaLabel: question.ignored ? 'Unignore question' : 'Ignore question', icon: question.ignored ? Eye : EyeOff, onClick: () => onIgnore(question.id, question.ignored), isVisible: gates.canIgnore, className: 'shrink-0 rounded-lg' },
  ];
}

export function QuestionsPanel({ questions, replyingTo, replySubject, replyText, canReply = true, canIgnore = true, onReplyingTo, onReplySubject, onReplyText, onReply, onIgnore }: Props): React.JSX.Element {
  const dict = useDictionary();
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
                  <div className="text-sm font-medium text-primary">{q.reply_subject}</div>
                  <div className="text-sm text-muted-foreground">{q.reply_text}</div>
                </div>
              )}
            </div>
            <RowActions
              ariaLabel={rowActionGroupLabel(dict, 'questions')}
              className="shrink-0"
              actions={buildQuestionActions(q, { canReply, canIgnore }, replyingTo, onReplyingTo, onIgnore)}
            />
          </div>
          {replyingTo === q.id && (
            <div className="mt-3 space-y-2 rounded-lg bg-muted/30 p-3">
              <input type="text" value={replySubject} onChange={(e) => onReplySubject(e.target.value)} placeholder="Reply subject" className={FIELD_CLASSES} />
              <textarea value={replyText} onChange={(e) => onReplyText(e.target.value)} placeholder="Reply message..." rows={2} className={FIELD_CLASSES} />
              <Button size="sm" variant="positive" onClick={() => onReply(q.id)}>Send Reply</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
