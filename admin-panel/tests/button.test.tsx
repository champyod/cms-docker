import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Trash2 } from 'lucide-react';
import {
  BUTTON_VARIANT_TO_ADAPTER,
  BUTTON_VARIANTS,
  Button,
  LEGACY_VARIANT_MAP,
  resolveVariant,
} from '@/components/core/Button';
import { buttonVariants } from '@/components/ui/button';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('public to adapter variant map', () => {
  it('maps every public variant, so a new one cannot skip the adapter', () => {
    expect(Object.keys(BUTTON_VARIANT_TO_ADAPTER).sort()).toEqual([...BUTTON_VARIANTS].sort());
  });

  it('keeps the public positive/negative names mapped onto the adapter vocabulary', () => {
    expect(BUTTON_VARIANT_TO_ADAPTER.positive).toBe('default');
    expect(BUTTON_VARIANT_TO_ADAPTER.positiveOutline).toBe('primaryOutline');
    expect(BUTTON_VARIANT_TO_ADAPTER.negative).toBe('destructive');
    expect(BUTTON_VARIANT_TO_ADAPTER.negativeOutline).toBe('destructiveOutline');
  });

  it('resolves every mapped variant to its own look, never the adapter default', () => {
    const looks = BUTTON_VARIANTS.map((variant) =>
      buttonVariants({ variant: BUTTON_VARIANT_TO_ADAPTER[variant] })
    );
    expect(new Set(looks).size).toBe(BUTTON_VARIANTS.length);
  });
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
  // Why the rendered button and not a console channel: the hazard being guarded is
  // a glyph-only control that a screen reader announces as nothing, so the misuse
  // is observable in the markup the caller actually receives.
  function openingButtonTag(html: string): string {
    const match = html.match(/<button\b[^>]*>/);
    if (!match) throw new Error('No button rendered');
    return match[0];
  }

  it('renders a glyph-only button with no accessible name and no tooltip when neither is given', () => {
    // Why the rendered name and not a console channel: the hazard this guards is
    // a glyph-only control that a screen reader announces as nothing, so the
    // guard is observable in the markup a caller actually receives.
    const html = renderToStaticMarkup(<Button icon={Trash2} />);
    const tag = openingButtonTag(html);
    expect(tag).not.toContain('aria-label=');
    expect(tag).not.toContain('aria-labelledby=');
    expect(tag).not.toContain('title=');
    expect(tag).not.toContain('data-slot="tooltip-trigger"');
    expect(html).not.toContain('aria-hidden="true"></button>');
    expect(html).toContain('aria-hidden="true"');
  });

  it('supplies the accessible name and tooltip trigger from the tooltip prop', () => {
    const html = renderToStaticMarkup(<Button icon={Trash2} tooltip="Delete item" />);
    const tag = openingButtonTag(html);
    expect(tag).toContain('aria-label="Delete item"');
    expect(tag).toContain('data-slot="tooltip-trigger"');
    expect(html).toContain('Delete item');
  });

  it('falls back to string children for the accessible name when no tooltip is given', () => {
    const html = renderToStaticMarkup(<Button iconOnly>Delete</Button>);
    expect(openingButtonTag(html)).toContain('aria-label="Delete"');
    expect(html).toContain('>Delete<');
  });

  it('renders square sizing for inferred icon-only buttons', () => {
    const html = renderToStaticMarkup(<Button icon={Trash2} tooltip="Delete" />);
    expect(html).toContain('w-11');
    expect(html).toContain('h-11');
    expect(html).toContain('p-0');
  });

  it('honors an explicit iconOnly flag even with children', () => {
    const html = renderToStaticMarkup(<Button iconOnly icon={Trash2} tooltip="Add" />);
    expect(html).toContain('w-11');
    expect(html).not.toContain('>Add<');
    expect(openingButtonTag(html)).toContain('aria-label="Add"');
  });
});
