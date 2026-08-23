'use client';

import { Plus, Send, Trash2 } from 'lucide-react';

interface AnnouncementRow {
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

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleString();
}

export function AnnouncementsPanel({ announcements, showForm, subject, text, onShowForm, onSubject, onText, onCreate, onDelete }: Props) {
  return (
    <div className="space-y-4">
      <button onClick={() => onShowForm(true)} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600/20 text-indigo-400 rounded-lg text-sm hover:bg-indigo-600/30">
        <Plus className="w-4 h-4" />New Announcement
      </button>
      {showForm && (
        <div className="p-4 bg-black/30 rounded-lg space-y-3">
          <input type="text" value={subject} onChange={(e) => onSubject(e.target.value)} placeholder="Subject" className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm" />
          <textarea value={text} onChange={(e) => onText(e.target.value)} placeholder="Message content..." rows={3} className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm" />
          <div className="flex gap-2">
            <button onClick={onCreate} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500"><Send className="w-4 h-4" /></button>
            <button onClick={() => onShowForm(false)} className="px-3 py-1.5 bg-neutral-700 text-white rounded-lg text-sm hover:bg-neutral-600">Cancel</button>
          </div>
        </div>
      )}
      {announcements.length === 0 ? <p className="text-neutral-500 text-sm">No announcements yet.</p> : (
        <div className="space-y-2">
          {announcements.map((ann) => (
            <div key={ann.id} className="p-3 bg-black/30 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-white">{ann.subject}</div>
                  <div className="text-sm text-neutral-300 mt-1">{ann.text}</div>
                  <div className="text-xs text-neutral-500 mt-2">{formatTime(ann.timestamp)} by {ann.admins?.username || 'System'}</div>
                </div>
                <button onClick={() => onDelete(ann.id)} className="p-1 text-red-400 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
