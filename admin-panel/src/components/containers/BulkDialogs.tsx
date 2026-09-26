'use client';

import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { RotateCcw, Trash2, ScrollText } from 'lucide-react';

import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import type { Dictionary } from '@/lib/dictionary';
import type { Dispatch, SetStateAction } from 'react';

type BulkCopy = Dictionary['containers']['bulk'];

interface BulkDialogsProps {
  readonly copy: BulkCopy;
  readonly selectedCount: number;
  readonly selectedNames: readonly string[];
  readonly restartPreview: readonly string[];
  readonly isDiscordConfigured: boolean | null;
  readonly bulkLoading: boolean;
  readonly showRestart: boolean;
  readonly showRemove: boolean;
  readonly showLogs: boolean;
  readonly setShowRestart: Dispatch<SetStateAction<boolean>>;
  readonly setShowRemove: Dispatch<SetStateAction<boolean>>;
  readonly setShowLogs: Dispatch<SetStateAction<boolean>>;
  readonly onConfirmRestart: () => void;
  readonly onConfirmRemove: () => void;
  readonly onConfirmLogs: () => void;
}

function Footer({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="flex justify-end gap-3 w-full">{children}</div>;
}

function DiscordWarning({ isDiscordConfigured }: {
  readonly isDiscordConfigured: boolean | null;
}): React.JSX.Element | null {
  const { discordWarning } = useDictionary().containers;
  if (isDiscordConfigured !== false) return null;
  return (
    <div className="bg-warning/10 border border-warning/20 rounded-lg p-2 text-xs text-warning">
      {discordWarning}
    </div>
  );
}

function SelectedNames({ names }: {
  readonly names: readonly string[];
}): React.JSX.Element {
  return (
    <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm font-mono text-foreground break-words">
      {names.join(', ')}
    </div>
  );
}

export function BulkDialogs({
  copy,
  selectedCount,
  selectedNames,
  restartPreview,
  isDiscordConfigured,
  bulkLoading,
  showRestart,
  showRemove,
  showLogs,
  setShowRestart,
  setShowRemove,
  setShowLogs,
  onConfirmRestart,
  onConfirmRemove,
  onConfirmLogs,
}: BulkDialogsProps): React.JSX.Element {
  const selectedDescription = interpolate(copy.selectedDescription, { count: selectedCount });
  return (
    <>
      <Dialog
        open={showRestart}
        onOpenChange={(open) => { if (!open) setShowRestart(false); }}
        title={copy.restartTitle}
        description={selectedDescription}
        footer={
          <Footer>
            <Button variant="ghost" onClick={() => setShowRestart(false)}>{copy.cancel}</Button>
            <Button variant="positive" onClick={onConfirmRestart} loading={bulkLoading}>
              <RotateCcw className="w-4 h-4 mr-2" />
              {copy.restartConfirm}
            </Button>
          </Footer>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{copy.restartDescription}</p>
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <div className="text-xs font-bold text-muted-foreground mb-1">{copy.restartPreviewLabel}</div>
            <div className="text-sm font-mono text-foreground break-words">
              {restartPreview.length > 0 ? restartPreview.join(' -> ') : selectedNames.join(', ')}
            </div>
            {restartPreview.length > 1 && (
              <div className="text-xs text-muted-foreground mt-1">{copy.restartDependents}</div>
            )}
          </div>
          <DiscordWarning isDiscordConfigured={isDiscordConfigured} />
        </div>
      </Dialog>

      <Dialog
        open={showRemove}
        onOpenChange={(open) => { if (!open) setShowRemove(false); }}
        title={copy.stopTitle}
        description={selectedDescription}
        footer={
          <Footer>
            <Button variant="ghost" onClick={() => setShowRemove(false)}>{copy.cancel}</Button>
            <Button variant="negative" onClick={onConfirmRemove} loading={bulkLoading}>
              <Trash2 className="w-4 h-4 mr-2" />
              {copy.stopConfirm}
            </Button>
          </Footer>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{copy.stopDescription}</p>
          <SelectedNames names={selectedNames} />
          <DiscordWarning isDiscordConfigured={isDiscordConfigured} />
        </div>
      </Dialog>

      <Dialog
        open={showLogs}
        onOpenChange={(open) => { if (!open) setShowLogs(false); }}
        title={copy.logsTitle}
        description={selectedDescription}
        footer={
          <Footer>
            <Button variant="ghost" onClick={() => setShowLogs(false)}>{copy.cancel}</Button>
            <Button variant="secondary" onClick={onConfirmLogs}>
              <ScrollText className="w-4 h-4 mr-2" />
              {copy.logsConfirm}
            </Button>
          </Footer>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{copy.logsDescription}</p>
          <SelectedNames names={selectedNames} />
        </div>
      </Dialog>
    </>
  );
}
