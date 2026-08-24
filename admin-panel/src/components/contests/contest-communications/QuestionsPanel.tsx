'use client';

import { Eye, EyeOff, Reply } from 'lucide-react';
import { Button } from '@/components/core/Button';

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
  onReplyingTo: (id: number | null) => void;
  onReplySubject: (v: string) => void;
  onReplyText: (v: string) => void;
  onReply: (id: number) => void;
  onIgnore: (id: number, ignored: boolean) => void;
}

const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleString();
}

export function QuestionsPanel({ questions, replyingTo, replySubject, replyText, onReplyingTo, onReplySubject, onReplyText, onReply, onIgnore }: Props) {
  if (questions.length === 0) return <p className="text-sm text-muted-foreground">No questions from contestants.</p>;
  return (
    <div className="space-y-3">
      {questions.map((q) => (
        <div key={q.id} className={`rounded-lg p-3 ${q.ignored ? 'bg-muted/50' : 'bg-muted/30'}`}>
          <div className="flex items-start justify-between">
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
            <div className="flex items-center gap-1">
              {!q.reply_timestamp && (
                <button onClick={() => onReplyingTo(replyingTo === q.id ? null : q.id)} aria-label={`Reply to ${q.subject}`} className="rounded p-1.5 text-primary transition-colors hover:bg-primary/20"><Reply className="h-4 w-4" /></button>
              )}
              <button onClick={() => onIgnore(q.id, q.ignored)} aria-label={q.ignored ? 'Unignore question' : 'Ignore question'} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted"><EyeOff className={q.ignored ? 'hidden' : 'h-4 w-4'} /><Eye className={q.ignored ? 'h-4 w-4' : 'hidden'} /></button>
            </div>
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
