export interface ParsedFile {
  originalName: string;
  id: string;
  type: 'input' | 'output' | null;
}

function toRegExpSource(pattern: string): string {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

  return '^' + escaped
    .replace(/\*\*/g, '(\\d{2})')
    .replace(/\*/g, '(\\d+)') + '$';
}

export function validatePattern(pattern: string): string {
  if (pattern.trim() === '') return 'Pattern must not be empty.';
  if (!pattern.includes('*')) return 'Pattern must contain * (number) or ** (2-digit number).';
  try {
    new RegExp(toRegExpSource(pattern));
  } catch {
    return 'Pattern is not a valid matcher.';
  }
  return '';
}

export function parseFilename(filename: string, pattern: string): string | null {
  const regex = new RegExp(toRegExpSource(pattern));
  const match = filename.match(regex);

  if (match && match[1]) {
     return match[1];
  }
  return null;
}

// Why an optional prefix: subtask-named files such as subtask1_01.in must
// keep their full stem as the codename, because the CMS score types match
// regexes like subtask1_.* against codenames. The strict parser above only
// captures digits, so a prefixed stem never matches and the file is dropped.
const SUBTASK_PREFIX_SOURCE = '([A-Za-z][A-Za-z0-9]*[_\-])?';

export function toPrefixTolerantRegExpSource(pattern: string): string {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

  // Why one pass: the prefix source itself contains a *, so a
  // second wildcard replace would re-scan the text it just
  // inserted and corrupt the pattern.
  const tolerant = escaped.replace(/\*\*|\*/g, (wildcard) => (
    wildcard === '**' ? `${SUBTASK_PREFIX_SOURCE}(\\d{2})` : `${SUBTASK_PREFIX_SOURCE}(\\d+)`
  ));
  return `^${tolerant}$`;
}

export function parseFilenameWithSubtask(filename: string, pattern: string): string | null {
  const strict = parseFilename(filename, pattern);
  if (strict !== null) return strict;
  const regex = new RegExp(toPrefixTolerantRegExpSource(pattern));
  const match = filename.match(regex);
  if (!match || match[2] === undefined) return null;
  return `${match[1] ?? ''}${match[2]}`;
}

export function parseSubtaskPrefix(codename: string): string | null {
  const match = codename.match(/^([A-Za-z][A-Za-z0-9]*)[_\-]\d+$/);
  return match ? match[1] : null;
}
