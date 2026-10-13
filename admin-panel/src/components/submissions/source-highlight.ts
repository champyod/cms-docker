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
