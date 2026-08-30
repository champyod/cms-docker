import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { ExternalToast } from 'sonner';
import {
  buildToastOptions,
  dispatchToast,
  resolveToastDuration,
} from '@/components/providers/ToastProvider';

type Variant = 'success' | 'error' | 'warning' | 'info';

type PublisherMethod = (title: string, data?: ExternalToast) => unknown;

type Publisher = Record<Variant, ReturnType<typeof vi.fn<PublisherMethod>>>;

const VARIANTS: readonly Variant[] = ['success', 'error', 'warning', 'info'];

function createPublisher(): Publisher {
  return {
    success: vi.fn<PublisherMethod>(),
    error: vi.fn<PublisherMethod>(),
    warning: vi.fn<PublisherMethod>(),
    info: vi.fn<PublisherMethod>(),
  };
}

function iconClassName(type: Variant): string | undefined {
  const { icon } = buildToastOptions({ type, title: 'T' }, 'id-1');
  const element = icon as ReactElement<{ className?: string }>;
  return element.props.className;
}

describe('dispatchToast variant routing', () => {
  for (const variant of VARIANTS) {
    it(`routes ${variant} to the ${variant} sonner method only`, () => {
      const publisher = createPublisher();
      const id = dispatchToast(publisher, { type: variant, title: 'Hello' });

      expect(publisher[variant]).toHaveBeenCalledTimes(1);
      expect(publisher[variant]).toHaveBeenCalledWith('Hello', expect.objectContaining({ id }));
      for (const other of VARIANTS.filter((candidate) => candidate !== variant)) {
        expect(publisher[other]).not.toHaveBeenCalled();
      }
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  }

  it('passes title as first argument and keeps ids unique per toast', () => {
    const publisher = createPublisher();
    const firstId = dispatchToast(publisher, { type: 'info', title: 'A' });
    const secondId = dispatchToast(publisher, { type: 'info', title: 'B' });

    expect(publisher.info).toHaveBeenNthCalledWith(1, 'A', expect.objectContaining({ id: firstId }));
    expect(publisher.info).toHaveBeenNthCalledWith(2, 'B', expect.objectContaining({ id: secondId }));
    expect(firstId).not.toBe(secondId);
  });
});

describe('buildToastOptions duration handling', () => {
  it('defaults missing duration to 5000ms', () => {
    const options = buildToastOptions({ type: 'success', title: 'Saved' }, 'id-1');
    expect(options.duration).toBe(5000);
  });

  it('passes finite durations through unchanged', () => {
    const options = buildToastOptions({ type: 'success', title: 'Saved', duration: 3000 }, 'id-1');
    expect(options.duration).toBe(3000);
  });

  it('keeps Infinity so sonner never auto-dismisses', () => {
    const options = buildToastOptions({ type: 'error', title: 'Failed', duration: Infinity }, 'id-1');
    expect(options.duration).toBe(Infinity);
  });

  it('treats legacy duration 0 as persistent', () => {
    const options = buildToastOptions({ type: 'info', title: 'Sticky', duration: 0 }, 'id-1');
    expect(options.duration).toBe(Infinity);
  });
});

describe('buildToastOptions payload passthrough', () => {
  it('maps message to description', () => {
    const options = buildToastOptions(
      { type: 'success', title: 'Contest Created', message: 'IOI-2025 is live' },
      'id-1',
    );
    expect(options.description).toBe('IOI-2025 is live');
  });

  it('passes action through for sonner action button rendering', () => {
    const onClick = vi.fn();
    const action = { label: 'Undo', onClick };
    const options = buildToastOptions(
      { type: 'warning', title: 'Deleted', action },
      'id-1',
    );
    expect(options.action).toEqual(action);
  });
});

describe('buildToastOptions semantic icons', () => {
  it('uses design-language icon colors per type without emoji', () => {
    expect(iconClassName('success')).toContain('text-emerald-400');
    expect(iconClassName('error')).toContain('text-red-400');
    expect(iconClassName('warning')).toContain('text-amber-400');
    expect(iconClassName('info')).toContain('text-cyan-400');
  });
});

describe('resolveToastDuration', () => {
  it('returns 5000 when undefined', () => {
    expect(resolveToastDuration(undefined)).toBe(5000);
  });

  it('returns Infinity for Infinity and non-positive values', () => {
    expect(resolveToastDuration(Infinity)).toBe(Infinity);
    expect(resolveToastDuration(0)).toBe(Infinity);
    expect(resolveToastDuration(-100)).toBe(Infinity);
  });

  it('returns positive finite values untouched', () => {
    expect(resolveToastDuration(12000)).toBe(12000);
  });
});
