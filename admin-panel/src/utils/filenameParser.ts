export interface ParsedFile {
  originalName: string;
  id: string;
  type: 'input' | 'output' | null;
}

export function parseFilename(filename: string, pattern: string): string | null {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  
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
