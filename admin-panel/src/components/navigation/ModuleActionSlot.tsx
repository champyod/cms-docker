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
 * Header actions published by a field's panel, scoped to one shell instance so two
 * mounted modules cannot overwrite each other's title row.
 *
 * `has` sits beside `read` because a panel withdraws by publishing `null`, which must
 * suppress a static entry rather than be confused with a slot nobody claimed.
 */
export interface ModuleActionStore {
  readonly register: (fieldId: RouteId, actions: ReactNode) => void;
  readonly unregister: (fieldId: RouteId) => void;
  readonly subscribe: (listener: StoreListener) => () => void;
  readonly read: (fieldId: string) => ReactNode | undefined;
  readonly has: (fieldId: string) => boolean;
}

function createModuleActionStore(): ModuleActionStore {
  const published = new Map<string, ReactNode>();
  const listeners = new Set<StoreListener>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    register: (fieldId, actions): void => {
      if (published.has(fieldId) && Object.is(published.get(fieldId), actions)) return;
      published.set(fieldId, actions);
      notify();
    },
    unregister: (fieldId): void => {
      if (!published.delete(fieldId)) return;
      notify();
    },
    subscribe: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    read: (fieldId): ReactNode | undefined => published.get(fieldId),
    has: (fieldId): boolean => published.has(fieldId),
  };
}

const ModuleActionStoreContext = createContext<ModuleActionStore | null>(null);

/** Owns one action store and hands it to the field panels rendered below the shell. */
export function ModuleActionScope({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [store] = useState(createModuleActionStore);
  return (
    <ModuleActionStoreContext.Provider value={store}>{children}</ModuleActionStoreContext.Provider>
  );
}

/**
 * Publishes a panel's header actions for the field it renders. The panel keeps
 * ownership of the state behind them, so the element is republished on every render
 * rather than copied; publishing `null` claims the slot with nothing in it.
 */
export function usePublishModuleActions(fieldId: RouteId, actions: ReactNode): void {
  const store = useContext(ModuleActionStoreContext);
  useLayoutEffect(() => {
    store?.register(fieldId, actions);
    return (): void => {
      store?.unregister(fieldId);
    };
  }, [store, fieldId, actions]);
}

const NO_UNSUBSCRIBE = (): void => undefined;

function useStoreSubscription(
  store: ModuleActionStore | null,
): (listener: StoreListener) => () => void {
  return useCallback(
    (listener: StoreListener): (() => void) => store?.subscribe(listener) ?? NO_UNSUBSCRIBE,
    [store],
  );
}

function useHasPublishedActions(store: ModuleActionStore | null, fieldId: string): boolean {
  const subscribe = useStoreSubscription(store);
  const read = useCallback((): boolean => store?.has(fieldId) ?? false, [store, fieldId]);
  return useSyncExternalStore(subscribe, read, read);
}

function usePublishedActions(
  store: ModuleActionStore | null,
  fieldId: string,
): ReactNode | undefined {
  const subscribe = useStoreSubscription(store);
  const read = useCallback((): ReactNode | undefined => store?.read(fieldId), [store, fieldId]);
  return useSyncExternalStore(subscribe, read, read);
}

/** What the given field's panel published: whether it claimed the slot, and what to show. */
export interface PublishedModuleActions {
  readonly isPublished: boolean;
  readonly actions: ReactNode | undefined;
}

/**
 * The active field's published actions. `isPublished` is reported apart from `actions`
 * because a panel publishing `null` has claimed the slot with nothing in it, which is a
 * different answer from a field whose slot nobody claimed.
 */
export function usePublishedModuleActions(fieldId: string): PublishedModuleActions {
  const store = useContext(ModuleActionStoreContext);
  const isPublished = useHasPublishedActions(store, fieldId);
  const actions = usePublishedActions(store, fieldId);
  return useMemo(() => ({ isPublished, actions }), [isPublished, actions]);
}
