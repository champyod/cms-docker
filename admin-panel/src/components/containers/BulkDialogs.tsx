'use client';

import { Dialog } from '@/components/core/Dialog';
import { ModalFooter } from '@/components/core/ModalFooter';
import { InlineAlert } from '@/components/core/InlineAlert';
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

function DiscordWarning({ isDiscordConfigured }: {
  readonly isDiscordConfigured: boolean | null;
}): React.JSX.Element | null {
  const { discordWarning } = useDictionary().containers;
  if (isDiscordConfigured !== false) return null;
  return (
    <InlineAlert tone="warning" density="compact" className="p-2">
      {discordWarning}
    </InlineAlert>
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
          <ModalFooter
            cancelLabel={copy.cancel}
            confirmLabel={copy.restartConfirm}
            onCancel={(): void => setShowRestart(false)}
            onConfirm={onConfirmRestart}
            confirmIcon={RotateCcw}
            confirmLoading={bulkLoading}
            cancelDisabled={false}
          />
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
          <ModalFooter
            cancelLabel={copy.cancel}
            confirmLabel={copy.stopConfirm}
            onCancel={(): void => setShowRemove(false)}
            onConfirm={onConfirmRemove}
            confirmIcon={Trash2}
            confirmVariant="negative"
            confirmLoading={bulkLoading}
            cancelDisabled={false}
          />
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
          <ModalFooter
            cancelLabel={copy.cancel}
            confirmLabel={copy.logsConfirm}
            onCancel={(): void => setShowLogs(false)}
            onConfirm={onConfirmLogs}
            confirmIcon={ScrollText}
            confirmVariant="secondary"
          />
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
