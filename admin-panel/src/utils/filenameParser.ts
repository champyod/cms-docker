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
