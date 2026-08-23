'use client';

import { Eye, EyeOff, Reply } from 'lucide-react';

interface QuestionRow {
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

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleString();
}

export function QuestionsPanel({ questions, replyingTo, replySubject, replyText, onReplyingTo, onReplySubject, onReplyText, onReply, onIgnore }: Props) {
  if (questions.length === 0) return <p className="text-neutral-500 text-sm">No questions from contestants.</p>;
  return (
    <div className="space-y-3">
      {questions.map((q) => (
        <div key={q.id} className={`p-3 rounded-lg ${q.ignored ? 'bg-neutral-800/50' : 'bg-black/30'}`}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{q.subject}</span>
                {q.ignored && <span className="text-xs text-neutral-500">(Ignored)</span>}
                {q.reply_timestamp && <span className="text-xs text-emerald-400">(Replied)</span>}
              </div>
              <div className="text-sm text-neutral-300 mt-1">{q.text}</div>
              <div className="text-xs text-neutral-500 mt-2">From: {q.participations?.users?.username} at {formatTime(q.question_timestamp)}</div>
              {q.reply_timestamp && (
                <div className="mt-3 p-2 bg-indigo-500/10 rounded-lg border-l-2 border-indigo-500">
                  <div className="text-sm font-medium text-indigo-300">{q.reply_subject}</div>
                  <div className="text-sm text-neutral-300">{q.reply_text}</div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!q.reply_timestamp && (
                <button onClick={() => onReplyingTo(replyingTo === q.id ? null : q.id)} className="p-1.5 text-indigo-400 hover:bg-indigo-500/20 rounded"><Reply className="w-4 h-4" /></button>
              )}
              <button onClick={() => onIgnore(q.id, q.ignored)} className="p-1.5 text-neutral-400 hover:bg-white/10 rounded">
                {q.ignored ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {replyingTo === q.id && (
            <div className="mt-3 p-3 bg-black/30 rounded-lg space-y-2">
              <input type="text" value={replySubject} onChange={(e) => onReplySubject(e.target.value)} placeholder="Reply subject" className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm" />
              <textarea value={replyText} onChange={(e) => onReplyText(e.target.value)} placeholder="Reply message..." rows={2} className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm" />
              <button onClick={() => onReply(q.id)} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500">Send Reply</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
