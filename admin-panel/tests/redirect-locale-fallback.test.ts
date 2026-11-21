import { beforeEach, describe, expect, it, vi } from 'vitest';

type Redirect = (target: string) => never;

/** Stands in for Next's control-flow throw so a call can be observed without a request. */
const nextRedirect = vi.fn<Redirect>(() => {
  throw new Error('NEXT_REDIRECT');
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock('next/headers');
  vi.doMock('next/navigation', () => ({ redirect: nextRedirect }));
});

async function loadRedirect(): Promise<typeof import('@/lib/redirect')> {
  return await import('@/lib/redirect');
}

describe('redirect() locale fallback', () => {
  it('uses the default locale when there is no request to read a Referer from', async () => {
    vi.doMock('next/headers', () => ({
      headers: async (): Promise<never> => {
        throw new Error('headers() was called outside a request scope');
      },
    }));
    const { redirect } = await loadRedirect();

    await expect(redirect('/dashboard')).rejects.toThrow('NEXT_REDIRECT');

    expect(nextRedirect).toHaveBeenCalledWith('/en/dashboard');
  });

  it('takes the locale from the Referer when there is one', async () => {
    vi.doMock('next/headers', () => ({
      headers: async (): Promise<Headers> =>
        new Headers({ referer: 'https://panel.example/th/contests' }),
    }));
    const { redirect } = await loadRedirect();

    await expect(redirect('/dashboard')).rejects.toThrow('NEXT_REDIRECT');

    expect(nextRedirect).toHaveBeenCalledWith('/th/dashboard');
  });
});
