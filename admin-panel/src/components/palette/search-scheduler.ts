export const SEARCH_DEBOUNCE_MS = 250;
export const MIN_QUERY_LENGTH = 2;
export const MAX_RESULTS_PER_ENTITY = 5;

export type ScheduledSearch = (signal: AbortSignal) => void;

export interface SearchScheduler {
  schedule(run: ScheduledSearch): void;
  cancel(): void;
}

export function createSearchScheduler(delayMs: number): SearchScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (controller !== null) controller.abort();
    controller = null;
  };

  const schedule = (run: ScheduledSearch): void => {
    cancel();
    controller = new AbortController();
    const activeController = controller;
    timer = setTimeout(() => {
      timer = null;
      run(activeController.signal);
    }, delayMs);
  };

  return { schedule, cancel };
}
