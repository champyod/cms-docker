'use client';

import type { RevealedState } from './useParticipationEditState';

interface Props {
  revealed: RevealedState;
  revealTab: 'plain' | 'stored';
  onTab: (t: 'plain' | 'stored') => void;
}

export function PasswordRevealPanel({ revealed, revealTab, onTab }: Props) {
  if (!revealed) return null;
  if (revealed.kind === 'bcrypt') {
    return (
      <div className="mt-3 p-3 bg-black/40 border border-white/10 rounded-lg">
        <div className="space-y-2">
          <p className="text-xs text-amber-300/90">Stored as bcrypt hash — irreversible. Type a new password above to replace it.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => onTab('plain')} className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${revealTab === 'plain' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-white/5 text-neutral-400 border-white/10 hover:text-white'}`}>Plain text</button>
            <button type="button" onClick={() => onTab('stored')} className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${revealTab === 'stored' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-white/5 text-neutral-400 border-white/10 hover:text-white'}`}>Stored form</button>
          </div>
          {revealTab === 'plain' ? <div className="px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-sm text-neutral-400 italic">— unavailable (bcrypt) —</div> : <div className="px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-sm text-neutral-300 font-mono break-all">bcrypt:$2…••••</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 p-3 bg-black/40 border border-white/10 rounded-lg">
      <div className="space-y-2">
        <div className="flex gap-2">
          <button type="button" onClick={() => onTab('plain')} className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${revealTab === 'plain' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-white/5 text-neutral-400 border-white/10 hover:text-white'}`}>Plain text</button>
          <button type="button" onClick={() => onTab('stored')} className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${revealTab === 'stored' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-white/5 text-neutral-400 border-white/10 hover:text-white'}`}>Stored form</button>
        </div>
        {revealTab === 'plain' ? <input readOnly value={revealed.value} placeholder="(empty)" className="w-full px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-white text-sm" /> : <div className="px-3 py-2 bg-black/80 border border-white/10 rounded-lg text-sm text-neutral-300 font-mono break-all">{revealed.value ? `plaintext:••••` : '(empty)'}</div>}
      </div>
    </div>
  );
}
