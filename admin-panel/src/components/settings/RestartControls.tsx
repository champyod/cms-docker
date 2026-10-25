'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getBoundContestId } from '@/app/actions/contests';
import { restartServices } from '@/app/actions/services';
import { Button } from '@/components/core/Button';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useDictionary } from '@/hooks/useDictionary';
import { useReasonPrompt, type ReasonActionResult } from '@/hooks/useReasonPrompt';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';

type StackType = 'core' | 'admin' | 'worker' | 'all';
type BoundContestRead = { loaded: false } | { loaded: true; contestId: number | null | 'unknown' };
type ServiceControlCopy = Dictionary['settings']['serviceControl'];

const STACK_TYPES: readonly StackType[] = ['core', 'admin', 'worker', 'all'];

// A failed read reports 'unknown', never null: the warning must not vanish while the panel is blind.
function useBoundContest(): BoundContestRead {
  const [read, setRead] = useState<BoundContestRead>({ loaded: false });

  useEffect(() => {
    void (async (): Promise<void> => {
      const result = await getBoundContestId().catch((): { success: false } => ({ success: false }));
      const contestId = result.success && result.binding !== undefined ? result.binding.contestId : 'unknown';
      setRead({ loaded: true, contestId });
    })();
  }, []);

  return read;
}

function getRestartWarning(contestId: number | null | 'unknown', copy: ServiceControlCopy): string | null {
  if (contestId === null) return null;
  if (contestId === 'unknown') return copy.contestLiveRestartUnknown;
  return interpolate(copy.contestLiveRestart, { contest: String(contestId) });
}

interface RestartButtonProps {
  readonly type: StackType;
  readonly label: string;
  readonly warning: string | null;
}

function RestartButton({ type, label, warning }: RestartButtonProps): ReactElement {
  const [isRestarting, setIsRestarting] = useState(false);
  const prompt = useReasonPrompt();
  const copy = useDictionary();
  const serviceControl = copy.settings.serviceControl;
  const toasts = copy.toasts.serviceControl;
  const { restartStackConfirm } = useConfirmationCopy();

  const handleRestart = (): void => {
    const base = restartStackConfirm(type);
    prompt.ask({
      title: base.title,
      description:
        warning === null
          ? `${base.description} ${serviceControl.restartReasonHint}`
          : `${base.description} ${serviceControl.restartReasonHint} ${warning}`,
      submitLabel: base.confirmLabel,
      run: async (reason: string): Promise<ReasonActionResult> => {
        setIsRestarting(true);
        try {
          const result = await restartServices(type, undefined, reason);
          if (result.success) toast.success(result.message);
          else toast.error(interpolate(toasts.actionFailed, { error: result.error }));
          return result;
        } catch {
          toast.error(toasts.restartFailed);
          return { success: false, error: toasts.restartFailed };
        } finally {
          setIsRestarting(false);
        }
      },
    });
  };

  return (
    <>
      <ReasonDialog request={prompt.request} onClose={prompt.close} onSubmit={prompt.submit} />
      <Button
        variant="positiveOutline"
        onClick={handleRestart}
        disabled={isRestarting}
        loading={isRestarting}
        icon={RefreshCw}
      >
        {isRestarting ? serviceControl.restarting : label}
      </Button>
    </>
  );
}

export function RestartControls(): ReactElement {
  const copy = useDictionary();
  const bound = useBoundContest();
  const warning = bound.loaded ? getRestartWarning(bound.contestId, copy.settings.serviceControl) : null;

  return (
    <>
      {warning !== null && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
        >
          {warning}
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STACK_TYPES.map((type) => (
          <RestartButton
            key={type}
            type={type}
            label={copy.confirmations.restartStack.labels[type]}
            warning={warning}
          />
        ))}
      </div>
    </>
  );
}
