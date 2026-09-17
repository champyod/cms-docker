import { DEPLOY_DISCOVERY_INTERVAL_MS } from '@/lib/constants/deploy';

interface ResumableDeploy {
  operationId: string;
  contestId: number;
}

type ResumeDeploy = (operationId: string, contestId: number) => void;

interface DeployReattachment {
  attach: (resume: ResumeDeploy) => () => void;
  invalidate: (operationId?: string | null) => void;
}

export function createDeployReattachment(
  load: () => Promise<ResumableDeploy | null>,
  intervalMs: number = DEPLOY_DISCOVERY_INTERVAL_MS,
): DeployReattachment {
  let generation = 0;
  const handled = new Set<string>();

  return {
    attach(resume): () => void {
      let disposed = false;
      const discover = async (): Promise<void> => {
        const started = generation;
        const operation = await load().catch(() => null);
        if (disposed || started !== generation || operation === null) return;
        // An operation is handed over once per mount: repeating the lookup is how this mount notices
        // the *next* one (a deploy another tab started, or one the watch released and the server
        // settled), and re-attaching the same operation would fight the state the panel already has.
        if (handled.has(operation.operationId)) return;
        handled.add(operation.operationId);
        resume(operation.operationId, operation.contestId);
      };
      // Why the lookup repeats instead of running once per mount: an operation that finishes while
      // this panel is already open must reach its activated (or rolled back) state without waiting
      // for a reload — the lookup is also what settles it, server side.
      void discover();
      const timer = setInterval(() => { void discover(); }, intervalMs);
      return (): void => { disposed = true; clearInterval(timer); };
    },
    invalidate(operationId?: string | null): void {
      // Why a generation and not just a flag: a lookup already in flight must not undo the newer user
      // action, while the repeating lookup above has to keep running afterwards.
      generation += 1;
      // A named operation is the one this mounting surface now owns — resumed, deployed or dismissed:
      // discovery must not hand it back.
      if (operationId) handled.add(operationId);
    },
  };
}
