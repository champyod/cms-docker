import { toast } from 'sonner';

import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';

/** Deploy notification copy, taken from the dictionary so the Thai locale reaches the toast. */
export type DeployToastCopy = Dictionary['toasts']['deploy'];

function buildProgressBar(copy: DeployToastCopy, percent: number | null): string {
  if (percent === null) return '';
  return interpolate(copy.progressDescription, { percent });
}

export function createDeployToast(copy: DeployToastCopy): {
  showProgress: (percent: number | null, contestId: number, status: string, toastIdRef: { current: string | number | null }) => void;
  dismiss: (toastIdRef: { current: string | number | null }) => void;
} {
  return {
    showProgress(percent, contestId, status, toastIdRef) {
      const message = percent !== null
        ? interpolate(copy.progressMessage, { contestId, percent })
        : interpolate(copy.progressStatusMessage, { contestId, status });
      const description = percent !== null ? buildProgressBar(copy, percent) : copy.waitingDescription;
      if (toastIdRef.current === null) {
        toastIdRef.current = toast.loading(message, { description, duration: Infinity });
      } else {
        toast.loading(message, { id: toastIdRef.current, description, duration: Infinity });
      }
    },
    dismiss(toastIdRef) {
      if (toastIdRef.current !== null) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
    },
  };
}

export function showDeployResult(copy: DeployToastCopy, status: string, contestId: number, error?: string): void {
  if (status === 'completed') toast.success(copy.completedTitle, { description: interpolate(copy.completedDescription, { contestId }) });
  else if (status === 'failed') toast.error(copy.failedTitle, { description: error || copy.failedDescription });
  // A 'timeout' is the panel's own watch ending while the deploy keeps running, so it is a warning
  // about what the panel can no longer show — never the server's failure text, which would read as
  // "the deploy died". Same reason it is not an error toast.
  else if (status === 'timeout') toast.warning(copy.watchingStoppedTitle, { description: copy.watchingStoppedDescription });
  else if (status === 'not_found') toast.error(copy.notFoundTitle, { description: error || copy.notFoundDescription });
}
