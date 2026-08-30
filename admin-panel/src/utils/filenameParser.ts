export interface ParsedFile {
  originalName: string;
  id: string; // The extracted ID (e.g. "1", "02")
  type: 'input' | 'output' | null;
}

/**
 * Parses a filename based on a pattern.
 * Patterns:
 *  *  -> Matches any number (equivalent to \d+)
 *  ** -> Matches 2 digits (equivalent to \d{2})
 * 
 * Example:
 *  Pattern: "task.*.in"
 *  Filename: "task.1.in" -> ID: "1"
 * 
 *  Pattern: "prob_**.out"
 *  Filename: "prob_01.out" -> ID: "01"
 */
export function parseFilename(filename: string, pattern: string): string | null {
  // Escape special regex characters except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  
  // Replace ** with (\d{2}) and * with (\d+)
  // We need to handle ** first to avoid overlapping with *
  const regexStr = '^' + escaped
    .replace(/\*\*/g, '(\\d{2})')
    .replace(/\*/g, '(\\d+)') + '$';
    
  const regex = new RegExp(regexStr);
  const match = filename.match(regex);
  
  if (match && match[1]) {
     return match[1];
  }
  return null;
}
