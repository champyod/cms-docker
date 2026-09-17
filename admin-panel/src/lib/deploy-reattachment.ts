interface InFlightDeploy {
  operationId: string;
  contestId: number;
}

type ResumeDeploy = (operationId: string, contestId: number) => void;

interface DeployReattachment {
  attach: (resume: ResumeDeploy) => () => void;
  invalidate: () => void;
}

export function createDeployReattachment(load: () => Promise<InFlightDeploy | null>): DeployReattachment {
  let lookup: Promise<InFlightDeploy | null> | null = null;
  let consumed = false;

  return {
    attach(resume): () => void {
      let disposed = false;
      // Cache the lookup, not the effect subscription: Strict Mode replays cleanup/setup.
      lookup ??= load().catch(() => null);
      void lookup.then((operation): void => {
        if (disposed || consumed) return;
        consumed = true;
        if (operation) resume(operation.operationId, operation.contestId);
      });
      return (): void => { disposed = true; };
    },
    invalidate(): void {
      // A delayed discovery must not undo a newer user action, including cancellation.
      consumed = true;
    },
  };
}
