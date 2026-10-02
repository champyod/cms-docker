'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { RouteId } from '@/lib/navigation/types';

type StoreListener = () => void;

/**
 * Header actions published by tab panels, scoped to one shell instance: two modules mounted
 * at once cannot overwrite each other's title row, and a panel unmounting takes its action
 * with it.
 *
 * Why `has` sits beside `read`: a panel withdraws its action by publishing `null`, and a slot
 * no panel claimed reads back as `undefined`, so presence has to be answerable on its own for
 * a published `null` to suppress the shell's static entry.
 */
export interface ModuleTabActionStore {
  readonly register: (tabId: RouteId, actions: ReactNode) => void;
  readonly unregister: (tabId: RouteId) => void;
  readonly subscribe: (listener: StoreListener) => () => void;
  readonly read: (tabId: string) => ReactNode | undefined;
  readonly has: (tabId: string) => boolean;
}

function createModuleTabActionStore(): ModuleTabActionStore {
  const published = new Map<string, ReactNode>();
  const listeners = new Set<StoreListener>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    register: (tabId, actions): void => {
      if (published.has(tabId) && Object.is(published.get(tabId), actions)) return;
      published.set(tabId, actions);
      notify();
    },
    unregister: (tabId): void => {
      if (!published.delete(tabId)) return;
      notify();
    },
    subscribe: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    read: (tabId): ReactNode | undefined => published.get(tabId),
    has: (tabId): boolean => published.has(tabId),
  };
}

const ModuleTabActionStoreContext = createContext<ModuleTabActionStore | null>(null);

/** Owns one action store and hands it to the tab panels rendered below the shell. */
export function ModuleTabActionScope({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [store] = useState(createModuleTabActionStore);
  return (
    <ModuleTabActionStoreContext.Provider value={store}>{children}</ModuleTabActionStoreContext.Provider>
  );
}

/**
 * Publishes a panel's header actions for the tab the panel renders. The panel keeps ownership
 * of the state behind them, so the element is republished on every render rather than copied;
 * publishing `null` claims the slot for that render with nothing in it.
 */
export function usePublishModuleTabActions(tabId: RouteId, actions: ReactNode): void {
  const store = useContext(ModuleTabActionStoreContext);
  useLayoutEffect(() => {
    store?.register(tabId, actions);
    return (): void => {
      store?.unregister(tabId);
    };
  }, [store, tabId, actions]);
}

const NO_UNSUBSCRIBE = (): void => undefined;

function useStoreSubscription(
  store: ModuleTabActionStore | null,
): (listener: StoreListener) => () => void {
  return useCallback(
    (listener: StoreListener): (() => void) => store?.subscribe(listener) ?? NO_UNSUBSCRIBE,
    [store],
  );
}

function useHasPublishedActions(store: ModuleTabActionStore | null, tabId: string): boolean {
  const subscribe = useStoreSubscription(store);
  const read = useCallback((): boolean => store?.has(tabId) ?? false, [store, tabId]);
  return useSyncExternalStore(subscribe, read, read);
}

function usePublishedActions(
  store: ModuleTabActionStore | null,
  tabId: string,
): ReactNode | undefined {
  const subscribe = useStoreSubscription(store);
  const read = useCallback((): ReactNode | undefined => store?.read(tabId), [store, tabId]);
  return useSyncExternalStore(subscribe, read, read);
}

/** What the given tab's panel published: whether it claimed the slot, and what to show in it. */
export interface PublishedTabActions {
  readonly isPublished: boolean;
  readonly actions: ReactNode | undefined;
}

/**
 * The active tab's published actions. `isPublished` is reported apart from `actions` because a
 * panel that publishes `null` has claimed the slot with nothing in it, which is a different
 * answer from a tab no panel ever claimed.
 */
export function usePublishedModuleTabActions(tabId: string): PublishedTabActions {
  const store = useContext(ModuleTabActionStoreContext);
  const isPublished = useHasPublishedActions(store, tabId);
  const actions = usePublishedActions(store, tabId);
  return useMemo(() => ({ isPublished, actions }), [isPublished, actions]);
}