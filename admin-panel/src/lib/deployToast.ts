import { toast } from 'sonner';

function buildProgressBar(percent: number | null): string {
  if (percent === null) return '';
  return `Progress ${percent}% pulling`;
}

export function createDeployToast(): {
  showProgress: (percent: number | null, contestId: number, status: string, toastIdRef: { current: string | number | null }) => void;
  dismiss: (toastIdRef: { current: string | number | null }) => void;
} {
  return {
    showProgress(percent, contestId, status, toastIdRef) {
      const message = percent !== null ? `Deploying contest #${contestId} — ${percent}% pulling` : `Deploying contest #${contestId} — ${status}`;
      const description = percent !== null ? buildProgressBar(percent) : 'Waiting for build output...';
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

export function showDeployResult(status: string, contestId: number, error?: string): void {
  if (status === 'completed') toast.success('Contest deployed', { description: `Contest #${contestId} is now active.` });
  else if (status === 'failed') toast.error('Deploy failed', { description: error || 'Deployment did not complete.' });
  else if (status === 'timeout') toast.error('Deploy timed out', { description: error || 'No output for 60 seconds.' });
  else if (status === 'not_found') toast.error('Deploy not found', { description: error || 'Operation unknown.' });
}
