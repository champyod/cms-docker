'use client';

import { Button } from '@/components/core/Button';
import { RotateCcw, Trash2, Terminal, X } from 'lucide-react';
import { motion } from 'motion/react';

interface ContainerBulkBarProps {
  selectedCount: number;
  isDiscordConfigured: boolean | null;
  bulkLoading: boolean;
  onClear: () => void;
  onRestart: () => void;
  onRemove: () => void;
  onLogs: () => void;
}

export function ContainerBulkBar({
  selectedCount,
  isDiscordConfigured,
  bulkLoading,
  onClear,
  onRestart,
  onRemove,
  onLogs,
}: ContainerBulkBarProps): React.JSX.Element | null {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center justify-between p-3 bg-card border border-border rounded-xl shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-foreground">{selectedCount} selected</span>
        {isDiscordConfigured === false && (
          <span className="px-2 py-1 bg-warning/10 border border-warning/20 text-warning text-xs font-bold rounded-full">
            Discord not configured
          </span>
        )}
        <button onClick={onClear} className="p-1 hover:bg-accent rounded-full text-muted-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="positiveOutline" size="sm" onClick={onRestart} disabled={bulkLoading} tooltip="Restart selected containers">
          <motion.span
            animate={bulkLoading ? { rotate: 360 } : { rotate: 0 }}
            transition={bulkLoading ? { repeat: Infinity, duration: 1, ease: 'linear' } : { duration: 0.2 }}
            className="flex"
          >
            <RotateCcw className="w-4 h-4" />
          </motion.span>
          Restart
        </Button>
        <Button variant="negativeOutline" size="sm" onClick={onRemove} tooltip="Stop selected containers">
          <Trash2 className="w-4 h-4" />
          Remove
        </Button>
        <Button variant="secondary" size="sm" onClick={onLogs} tooltip="View logs for selection">
          <Terminal className="w-4 h-4" />
          Logs
        </Button>
      </div>
    </div>
  );
}
