// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { surfaceLoadMessages, useSurfaceLoad, type SurfaceLoadMessages } from '@/hooks/useSurfaceLoad';
import en from '@/dictionaries/en.json';

afterEach(cleanup);

const MESSAGES: SurfaceLoadMessages = {
  denied: { title: 'Denied' },
  failed: { title: 'Failed' },
};

describe('useSurfaceLoad', () => {
  it('ends a resolved load in its data and an idle status', async () => {
    const { result } = renderHook(() => useSurfaceLoad(async () => 7, MESSAGES));
    await waitFor(() => expect(result.current.status.kind).toBe('idle'));
    expect(result.current.data).toBe(7);
  });

  it('reads a refusal as denied, from the marker on the thrown message', async () => {
    const { result } = renderHook(() =>
      useSurfaceLoad(
        async () => { throw new Error('Unauthorized: Missing env:read permission'); },
        MESSAGES,
      ),
    );
    await waitFor(() => expect(result.current.status.kind).toBe('error'));
    expect(result.current.status).toMatchObject({ title: 'Denied' });
    expect(result.current.data).toBeNull();
  });

  it('reads any other rejection as failed', async () => {
    const { result } = renderHook(() =>
      useSurfaceLoad(
        async () => { throw new Error('config.toml is unreadable'); },
        MESSAGES,
      ),
    );
    await waitFor(() => expect(result.current.status.kind).toBe('error'));
    expect(result.current.status).toMatchObject({ title: 'Failed' });
  });

  it('re-runs the load and returns to loading on reload', async () => {
    const load = vi.fn(async () => 'value');
    const { result } = renderHook(() => useSurfaceLoad(load, MESSAGES));
    await waitFor(() => expect(result.current.status.kind).toBe('idle'));

    act(() => result.current.reload());
    expect(result.current.status.kind).toBe('loading');
    await waitFor(() => expect(result.current.status.kind).toBe('idle'));
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('surfaceLoadMessages', () => {
  it('reads the denied and failed copy from the dictionary', () => {
    const messages = surfaceLoadMessages(en);
    expect(messages.denied).toEqual({ title: en.errors.permissionDenied, description: en.errors.contactAdmin });
    expect(messages.failed).toEqual({ title: en.states.error.generic, description: en.states.retry.description });
  });
});
