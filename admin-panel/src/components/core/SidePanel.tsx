'use client';

import { useCallback, useContext, useRef } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import en from '@/dictionaries/en.json';
import { DictionaryContext } from '@/hooks/useDictionary';
import { cn } from '@/lib/utils';

export interface SidePanelProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * Panel for reading one record's detail while the list stays on screen.
 *
 * Why a non-modal root: a modal root hides the list behind an overlay and takes
 * focus away from the rows the reader is comparing against, which defeats the
 * only reason to open a detail beside a list. A bounded create, edit or confirm
 * keeps the Dialog, and a live operation keeps its own persistent surface.
 *
 * Why focus-outside is refused: a reader who tabs from the panel back into the
 * list is comparing the two, and a panel that closed on that tab would be a panel
 * that can only be read once. A pointer press outside is still a dismissal.
 *
 * Why the invoker capture mirrors the Dialog's: a panel opened from a row can
 * have that row filtered out by an auto-refresh before the panel closes, and
 * focusing a detached node is a silent no-op that strands focus on the body.
 */
function PanelHeader({
  title,
  description,
  closeLabel,
  onClose,
}: {
  readonly title: string;
  readonly description: string | undefined;
  readonly closeLabel: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <SheetTitle>{title}</SheetTitle>
        {description !== undefined && <SheetDescription>{description}</SheetDescription>}
      </div>
      <Button variant="secondary" size="sm" iconOnly icon={X} tooltip={closeLabel} onClick={onClose} />
    </div>
  );
}

export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: SidePanelProps): React.JSX.Element | null {
  const dictionary = useContext(DictionaryContext);
  const closeLabel = (dictionary ?? en).sidePanel.close;
  const invokeRef = useRef<HTMLElement | null>(null);

  const rememberInvoker = useCallback((): void => {
    if (invokeRef.current === null && document.activeElement instanceof HTMLElement) {
      invokeRef.current = document.activeElement;
    }
  }, []);

  const restoreInvoker = useCallback((event: Event): void => {
    event.preventDefault();
    const invoker = invokeRef.current;
    invokeRef.current = null;
    if (invoker?.isConnected === true) invoker.focus();
  }, []);

  if (!open) return null;

  return (
    <Sheet modal={false} open onOpenChange={onOpenChange}>
      <SheetContent
        data-slot="side-panel"
        className={cn('flex flex-col gap-4', className)}
        onOpenAutoFocus={rememberInvoker}
        onCloseAutoFocus={restoreInvoker}
        onFocusOutside={(event) => { event.preventDefault(); }}
      >
        <PanelHeader
          title={title}
          description={description}
          closeLabel={closeLabel}
          onClose={(): void => onOpenChange(false)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
