'use client';

import { Plus, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/core/Button';

export interface AnnouncementRow {
  id: number;
  subject: string;
  text: string;
  timestamp: string | Date;
  admins?: { username: string } | null;
}

interface Props {
  announcements: AnnouncementRow[];
  showForm: boolean;
  subject: string;
  text: string;
  onShowForm: (v: boolean) => void;
  onSubject: (v: string) => void;
  onText: (v: string) => void;
  onCreate: () => void;
  onDelete: (id: number) => void;
}

const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleString();
}

export function AnnouncementsPanel({ announcements, showForm, subject, text, onShowForm, onSubject, onText, onCreate, onDelete }: Props) {
  return (
    <div className="space-y-4">
      <Button variant="positiveOutline" size="sm" icon={Plus} onClick={() => onShowForm(true)}>New Announcement</Button>
      {showForm && (
        <div className="space-y-3 rounded-lg bg-muted/30 p-4">
          <input type="text" value={subject} onChange={(e) => onSubject(e.target.value)} placeholder="Subject" className={FIELD_CLASSES} />
          <textarea value={text} onChange={(e) => onText(e.target.value)} placeholder="Message content..." rows={3} className={FIELD_CLASSES} />
          <div className="flex gap-2">
            <Button variant="positive" size="sm" icon={Send} tooltip="Send announcement" onClick={onCreate} />
            <Button variant="secondary" size="sm" onClick={() => onShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {announcements.length === 0 ? <p className="text-sm text-muted-foreground">No announcements yet.</p> : (
        <div className="space-y-2">
          {announcements.map((ann) => (
            <div key={ann.id} className="rounded-lg bg-muted/30 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-foreground">{ann.subject}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{ann.text}</div>
                  <div className="mt-2 text-xs text-muted-foreground">{formatTime(ann.timestamp)} by {ann.admins?.username || 'System'}</div>
                </div>
                <button onClick={() => onDelete(ann.id)} aria-label={`Delete announcement ${ann.subject}`} className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
