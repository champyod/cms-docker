import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'src/app/globals.css'), 'utf8');
const viewer = readFileSync(
  join(__dirname, '..', 'src/components/submissions/SubmissionSourceViewer.tsx'),
  'utf8',
);

describe('submission source surface', () => {
  it('takes its background from the card rather than a bundled theme of its own', () => {
    // The github-dark theme the viewer used to import paints `.hljs` #0d1117 — a surface of its own
    // under the card, and a light-on-dark palette the light theme cannot survive.
    expect(css).not.toMatch(/\.hljs\s*\{[^}]*background/);
    expect(viewer).not.toContain('highlight.js/styles');
    expect(viewer).toContain('source-code');
  });

  it('colours the code from the panel tokens so it follows every theme', () => {
    expect(css).toMatch(/\.source-code\s*\{[^}]*color:\s*var\(--card-foreground\)/);
    expect(css).toMatch(/\.source-code \.hljs-string[^{]*\{[^}]*color:\s*var\(--success\)/);
    expect(css).toMatch(/\.source-code \.hljs-comment[^{]*\{[^}]*color:\s*var\(--muted-foreground\)/);
  });

  it('gives the code surface no background utility of its own', () => {
    const scrollClass = /const SCROLL_CLASS = '([^']*)'/.exec(viewer)?.[1] ?? '';
    expect(scrollClass).toContain('source-code');
    expect(scrollClass).not.toContain('bg-');
  });
});
