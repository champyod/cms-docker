import { describe, expect, it } from 'vitest';

import { highlightSource, splitHighlightedLines } from '@/components/submissions/source-highlight';

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function balance(line: string): number {
  return (line.match(/<span /g) ?? []).length - (line.match(/<\/span>/g) ?? []).length;
}

describe('highlighted line splitter', () => {
  it('cuts markup at newlines and re-opens an unclosed span on the next line', () => {
    expect(splitHighlightedLines('<span class="hljs-string">a\nb</span>'))
      .toEqual(['<span class="hljs-string">a</span>', '<span class="hljs-string">b</span>']);
  });

  it('re-opens nested spans in their original order', () => {
    expect(splitHighlightedLines('<span class="a"><span class="b">x\ny</span></span>'))
      .toEqual(['<span class="a"><span class="b">x</span></span>', '<span class="a"><span class="b">y</span></span>']);
  });

  it('leaves one entry per source line and no entry behind a trailing newline', () => {
    expect(splitHighlightedLines('one\ntwo\n')).toEqual(['one', 'two']);
    expect(splitHighlightedLines('')).toEqual([]);
    expect(splitHighlightedLines('\n')).toEqual(['']);
  });

  it('splits real highlight.js markup into the code’s own lines, every one balanced', () => {
    const code = 'def f():\n    """doc\n    string"""\n    return 1\n';

    const lines = splitHighlightedLines(highlightSource(code, 'Python 3 / CPython'));

    expect(lines).toHaveLength(4);
    expect(lines.map(stripTags).join('\n')).toBe(code.trimEnd());
    for (const line of lines) expect(balance(line)).toBe(0);
  });

  it('keeps the colour of a token that spans the cut', () => {
    // The docstring opens on line 2 and closes on line 3, so line 3 has to re-open the string span
    // highlight.js left unclosed — the markup a single-block render would have produced.
    const lines = splitHighlightedLines(highlightSource('x = """a\nb"""\n', 'Python 3 / CPython'));

    expect(lines[0]).toContain('<span class="hljs-string">');
    expect(lines[0].endsWith('</span>')).toBe(true);
    expect(lines[1].startsWith('<span class="hljs-string">')).toBe(true);
  });
});
