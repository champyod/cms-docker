'use client';

import { cn } from '@/lib/utils';
import type { RevealedState } from './useParticipationEditState';

interface Props {
  revealed: RevealedState;
  revealTab: 'plain' | 'stored';
  onTab: (t: 'plain' | 'stored') => void;
}

const PANEL_CLASSES = 'mt-3 rounded-lg border border-border bg-muted/40 p-3';
const TAB_ACTIVE = 'rounded-lg border border-primary/30 bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary transition-colors';
const TAB_INACTIVE = 'rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground';
const VALUE_CLASSES = 'rounded-lg border border-input bg-background px-3 py-2 text-sm';

function RevealTabs({ revealTab, onTab }: Pick<Props, 'revealTab' | 'onTab'>) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onTab('plain')} className={cn(revealTab === 'plain' ? TAB_ACTIVE : TAB_INACTIVE)}>Plain text</button>
      <button type="button" onClick={() => onTab('stored')} className={cn(revealTab === 'stored' ? TAB_ACTIVE : TAB_INACTIVE)}>Stored form</button>
    </div>
  );
}

export function PasswordRevealPanel({ revealed, revealTab, onTab }: Props) {
  if (!revealed) return null;
  if (revealed.kind === 'bcrypt') {
    return (
      <div className={PANEL_CLASSES}>
        <div className="space-y-2">
          <p className="text-xs text-warning">Stored as bcrypt hash — irreversible. Type a new password above to replace it.</p>
          <RevealTabs revealTab={revealTab} onTab={onTab} />
          {revealTab === 'plain'
            ? <div className={cn(VALUE_CLASSES, 'italic text-muted-foreground')}>— unavailable (bcrypt) —</div>
            : <div className={cn(VALUE_CLASSES, 'break-all font-mono text-foreground')}>bcrypt:$2…••••</div>}
        </div>
      </div>
    );
  }
  return (
    <div className={PANEL_CLASSES}>
      <div className="space-y-2">
        <RevealTabs revealTab={revealTab} onTab={onTab} />
        {revealTab === 'plain'
          ? <input readOnly value={revealed.value} placeholder="(empty)" className={cn(VALUE_CLASSES, 'w-full text-foreground')} />
          : <div className={cn(VALUE_CLASSES, 'break-all font-mono text-foreground')}>{revealed.value ? `plaintext:••••` : '(empty)'}</div>}
      </div>
    </div>
  );
}
