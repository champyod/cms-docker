'use client';

import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { RotateCcw, Trash2, Terminal } from 'lucide-react';

interface BulkDialogsProps {
  selectedCount: number;
  selectedNames: string[];
  restartPreview: string[];
  isDiscordConfigured: boolean | null;
  bulkLoading: boolean;
  showRestart: boolean;
  showRemove: boolean;
  showLogs: boolean;
  onCloseRestart: (open: boolean) => void;
  onCloseRemove: (open: boolean) => void;
  onCloseLogs: (open: boolean) => void;
  onConfirmRestart: () => void;
  onConfirmRemove: () => void;
  onConfirmLogs: () => void;
}

export function BulkDialogs({
  selectedCount,
  selectedNames,
  restartPreview,
  isDiscordConfigured,
  bulkLoading,
  showRestart,
  showRemove,
  showLogs,
  onCloseRestart,
  onCloseRemove,
  onCloseLogs,
  onConfirmRestart,
  onConfirmRemove,
  onConfirmLogs,
}: BulkDialogsProps): React.JSX.Element {
  return (
    <>
      <Dialog
        open={showRestart}
        onOpenChange={(open) => { if (!open) onCloseRestart(false); }}
        title="Confirm Restart"
        description={`${selectedCount} containers selected`}
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button variant="ghost" onClick={() => onCloseRestart(false)}>Cancel</Button>
            <Button variant="positive" onClick={onConfirmRestart} loading={bulkLoading}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Confirm Restart
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">This will restart the selected containers and their dependents.</p>
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <div className="text-xs font-bold text-muted-foreground mb-1">This will restart:</div>
            <div className="text-sm font-mono text-foreground break-words">
              {restartPreview.length > 0 ? restartPreview.join(' -> ') : selectedNames.join(', ')}
            </div>
          </div>
          {isDiscordConfigured === false && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-2 text-xs text-warning">Discord not configured — notifications will be skipped</div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={showRemove}
        onOpenChange={(open) => { if (!open) onCloseRemove(false); }}
        title="Confirm Stop"
        description={`${selectedCount} containers selected`}
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button variant="ghost" onClick={() => onCloseRemove(false)}>Cancel</Button>
            <Button variant="negative" onClick={onConfirmRemove} loading={bulkLoading}>
              <Trash2 className="w-4 h-4 mr-2" />
              Confirm Stop
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">This will stop the selected containers.</p>
          <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm font-mono text-foreground break-words">
            {selectedNames.join(', ')}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={showLogs}
        onOpenChange={(open) => { if (!open) onCloseLogs(false); }}
        title="View Logs"
        description={`${selectedCount} containers selected`}
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button variant="ghost" onClick={() => onCloseLogs(false)}>Cancel</Button>
            <Button variant="secondary" onClick={onConfirmLogs}>
              <Terminal className="w-4 h-4 mr-2" />
              View Logs
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Open logs for the first selected container.</p>
          <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm font-mono text-foreground break-words">
            {selectedNames.join(', ')}
          </div>
        </div>
      </Dialog>
    </>
  );
}
