import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Grid, Stack } from '@/components/core/Layout';

/**
 * The layout primitives must emit class names Tailwind can see.
 *
 * WHY: these components build their spacing from props, and the first version interpolated it —
 * `gap-${gap}`, `items-${align}`. Tailwind generates a utility from the text in the source, so an
 * interpolated class exists only if some unrelated file happens to contain the same literal. The
 * spacing then works in development and silently disappears when that other file changes. A static
 * map makes each class visible, and these tests pin the mapping so a "clever" refactor cannot bring
 * the interpolation back.
 */

const SUPPORTED_GAPS = [0, 1, 2, 3, 4, 5, 6, 8, 12] as const;

describe('Stack and Grid emit literal spacing classes', () => {
  it('maps every supported gap to a real utility', () => {
    for (const gap of SUPPORTED_GAPS) {
      const markup = renderToStaticMarkup(
        <Stack gap={gap}>
          <span />
        </Stack>,
      );
      expect(markup, `gap ${gap}`).toContain(`gap-${gap}`);
    }
  });

  it('applies the same ladder to Grid', () => {
    for (const gap of SUPPORTED_GAPS) {
      const markup = renderToStaticMarkup(
        <Grid gap={gap} cols={2}>
          <span />
        </Grid>,
      );
      expect(markup, `gap ${gap}`).toContain(`gap-${gap}`);
    }
  });

  it('maps alignment and justification explicitly', () => {
    const markup = renderToStaticMarkup(
      <Stack align="center" justify="between" gap={2}>
        <span />
      </Stack>,
    );
    expect(markup).toContain('items-center');
    expect(markup).toContain('justify-between');
  });

  it('emits no spacing class at all for a value outside the ladder', () => {
    // Reached only from untyped callers (prose examples, JSON-driven layout). Silence is the honest
    // outcome: the alternative was a made-up class name that looked like it worked.
    const markup = renderToStaticMarkup(
      <Stack gap={7 as never}>
        <span />
      </Stack>,
    );
    expect(markup).not.toMatch(/gap-\S+/);
  });
});
