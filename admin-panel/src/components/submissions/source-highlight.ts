import hljs from 'highlight.js/lib/core';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import delphi from 'highlight.js/lib/languages/delphi';
import haskell from 'highlight.js/lib/languages/haskell';
import java from 'highlight.js/lib/languages/java';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';

// Why core plus an explicit grammar set: the full highlight.js bundle carries
// every language the panel will never highlight, and a contest only ever grades
// the languages the task allows.
const GRAMMARS = { c, cpp, csharp, delphi, haskell, java, php, plaintext, python, rust } as const;

type Grammar = keyof typeof GRAMMARS;

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  hljs.registerLanguage(name, grammar);
}

// Why the prefix table: a contest language label carries its toolchain after the
// language ("C++17 / g++", "Python 3 / CPython"), so the leading token is what
// selects the grammar.
const GRAMMAR_PREFIXES: readonly (readonly [string, Grammar])[] = [
  ['c#', 'csharp'],
  ['c++', 'cpp'],
  ['c11', 'c'],
  ['haskell', 'haskell'],
  ['java', 'java'],
  ['pascal', 'delphi'],
  ['php', 'php'],
  ['python', 'python'],
  ['rust', 'rust'],
];

const PLAIN: Grammar = 'plaintext';

function resolveGrammar(language: string | null): Grammar {
  if (language === null) return PLAIN;
  const label = language.trim().toLowerCase();
  const match = GRAMMAR_PREFIXES.find(([prefix]) => label.startsWith(prefix));
  return match ? match[1] : PLAIN;
}

/**
 * Renders code as highlight.js HTML for the submission's language.
 *
 * An unknown language falls back to the plaintext grammar rather than a guess,
 * which would colour the code as a language it is not. The library escapes the
 * code, so the result is safe to inject as markup.
 */
export function highlightSource(code: string, language: string | null): string {
  return hljs.highlight(code, { language: resolveGrammar(language) }).value;
}

// highlight.js emits nothing but escaped text, `<span class="…">` and `</span>`, so the three
// alternatives below cover its whole output grammar.
const TAG_OR_TEXT = /<span class="([^"]*)">|<\/span>|([^<]+)/g;

/**
 * Cuts highlighted markup into one entry per line of the code it came from.
 *
 * Why the open-tag bookkeeping: a diff marks single lines, while highlight.js colours the document
 * whole, so a token spanning a line break — a block comment, a multi-line string — is still open
 * where the row ends. Every row therefore closes what it inherited and re-opens it on the next one,
 * which keeps each row valid markup and keeps a spanning token's colour identical to what a
 * single-block render shows.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  for (const match of html.matchAll(TAG_OR_TEXT)) {
    const [, opened, text] = match;
    if (opened !== undefined) {
      open.push(opened);
      line += `<span class="${opened}">`;
      continue;
    }
    if (text === undefined) {
      line += '</span>';
      open.pop();
      continue;
    }
    for (const [index, part] of text.split('\n').entries()) {
      if (index > 0) {
        lines.push(line + '</span>'.repeat(open.length));
        line = open.map((name) => `<span class="${name}">`).join('');
      }
      line += part;
    }
  }
  lines.push(line);
  // Mirrors the diff's own split: a trailing newline is a line terminator, not a line of its own.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** The code's lines, each already highlighted, for a row-by-row render. */
export function highlightedLines(code: string, language: string | null): string[] {
  return splitHighlightedLines(highlightSource(code, language));
}
