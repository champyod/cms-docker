import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Trash2 } from 'lucide-react';
import { Button, LEGACY_VARIANT_MAP, resolveVariant } from '@/components/core/Button';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('legacy variant mapping', () => {
  it('maps primary to positive and danger to negative', () => {
    expect(LEGACY_VARIANT_MAP.primary).toBe('positive');
    expect(LEGACY_VARIANT_MAP.danger).toBe('negative');
  });

  it('resolves legacy names and passes canonical ones through', () => {
    expect(resolveVariant('primary')).toBe('positive');
    expect(resolveVariant('danger')).toBe('negative');
    expect(resolveVariant('secondary')).toBe('secondary');
    expect(resolveVariant('ghost')).toBe('ghost');
    expect(resolveVariant('positiveOutline')).toBe('positiveOutline');
    expect(resolveVariant('negativeOutline')).toBe('negativeOutline');
    expect(resolveVariant('link')).toBe('link');
  });

  it('defaults to positive when no variant given', () => {
    expect(resolveVariant(undefined)).toBe('positive');
  });
});

describe('rendered variants', () => {
  it('renders filled positive by default', () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain('<button');
    expect(html).toContain('bg-primary');
    expect(html).toContain('type="button"');
  });

  it('renders positiveOutline without fill', () => {
    const html = renderToStaticMarkup(<Button variant="positiveOutline">Approve</Button>);
    expect(html).toContain('border-primary');
    expect(html).toContain('text-primary');
    expect(html).toContain('bg-transparent');
  });

  it('renders negativeOutline with red border, transparent bg, red text', () => {
    const html = renderToStaticMarkup(<Button variant="negativeOutline">Delete</Button>);
    expect(html).toContain('border-destructive');
    expect(html).toContain('text-destructive');
    expect(html).toContain('bg-transparent');
  });

  it('renders legacy danger as filled destructive', () => {
    const html = renderToStaticMarkup(<Button variant="danger">Delete</Button>);
    expect(html).toContain('bg-destructive');
  });

  it('keeps legacy size API', () => {
    const html = renderToStaticMarkup(<Button size="sm">Go</Button>);
    expect(html).toContain('h-11');
  });
});

describe('loading state', () => {
  it('disables the button and shows a spinner', () => {
    const html = renderToStaticMarkup(<Button loading>Save</Button>);
    expect(html).toContain('disabled');
    expect(html).toContain('animate-spin');
  });

  it('marks itself busy for assistive tech', () => {
    const html = renderToStaticMarkup(<Button loading>Save</Button>);
    expect(html).toContain('aria-busy="true"');
  });
});

describe('icon support', () => {
  it('renders the leading icon before children', () => {
    const html = renderToStaticMarkup(<Button icon={Trash2}>Delete</Button>);
    const iconIndex = html.indexOf('lucide');
    const labelIndex = html.indexOf('>Delete<');
    expect(iconIndex).toBeGreaterThan(-1);
    expect(labelIndex).toBeGreaterThan(iconIndex);
  });
});

describe('iconOnly mode', () => {
  it('warns in development when tooltip is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderToStaticMarkup(<Button icon={Trash2} />);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tooltip'));
  });

  it('does not warn when tooltip is provided and sets aria-label', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderToStaticMarkup(<Button icon={Trash2} tooltip="Delete item" />);
    expect(warn).not.toHaveBeenCalled();
    expect(html).toContain('aria-label="Delete item"');
  });

  it('renders square sizing for inferred icon-only buttons', () => {
    const html = renderToStaticMarkup(<Button icon={Trash2} tooltip="Delete" />);
    expect(html).toContain('w-11');
    expect(html).toContain('h-10');
    expect(html).toContain('p-0');
  });

  it('honors an explicit iconOnly flag even with children', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderToStaticMarkup(<Button iconOnly icon={Trash2} tooltip="Add" />);
    expect(warn).not.toHaveBeenCalled();
    expect(html).toContain('w-11');
    expect(html).not.toContain('>Add<');
  });
});
