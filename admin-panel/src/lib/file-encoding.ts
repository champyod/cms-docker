export type FileEncoding =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'windows-1252'
  | 'iso-8859-1'
  | 'binary';

export interface EncodingOption {
  value: FileEncoding;
  label: string;
}

export const ENCODING_OPTIONS: EncodingOption[] = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'windows-1252', label: 'Windows-1252' },
  { value: 'iso-8859-1', label: 'ISO-8859-1' },
  { value: 'binary', label: 'Raw bytes' },
];

const BOM_UTF8 = [0xef, 0xbb, 0xbf];
const BOM_UTF16_LE = [0xff, 0xfe];
const BOM_UTF16_BE = [0xfe, 0xff];

function startsWithBytes(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }
  return prefix.every((value, index) => bytes[index] === value);
}

function isLikelyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return true;
  }

  let printable = 0;
  for (const byte of bytes) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      printable += 1;
      continue;
    }
    if (byte >= 0x20 && byte <= 0x7e) {
      printable += 1;
      continue;
    }
    if (byte >= 0xa0) {
      printable += 1;
    }
  }

  return printable / bytes.length >= 0.7;
}

function scoreDecodedText(value: string): number {
  if (!value) {
    return 0;
  }

  let score = 0;
  let textChars = 0;
  let controlChars = 0;

  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === '\n' || char === '\r' || char === '\t') {
      score += 3;
      textChars += 1;
      continue;
    }
    if (code >= 0x20 && code !== 0x7f) {
      score += 2;
      textChars += 1;
      continue;
    }
    if (code === 0) {
      controlChars += 1;
      score -= 4;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      controlChars += 1;
      score -= 1;
    }
  }

  score += Math.min(textChars, 200) / 10;
  score -= controlChars * 0.5;
  return score;
}

function tryDecode(bytes: Uint8Array, encoding: Exclude<FileEncoding, 'binary'>): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function detectFileEncoding(bytes: Uint8Array): FileEncoding {
  if (bytes.length === 0) {
    return 'utf-8';
  }

  if (startsWithBytes(bytes, BOM_UTF8)) {
    return 'utf-8';
  }
  if (startsWithBytes(bytes, BOM_UTF16_LE)) {
    return 'utf-16le';
  }
  if (startsWithBytes(bytes, BOM_UTF16_BE)) {
    return 'utf-16be';
  }

  const zeroCount = bytes.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  if (zeroCount > 0) {
    let evenZeroCount = 0;
    let oddZeroCount = 0;

    bytes.forEach((byte, index) => {
      if (byte !== 0) {
        return;
      }
      if (index % 2 === 0) {
        evenZeroCount += 1;
      } else {
        oddZeroCount += 1;
      }
    });

    const zeroRatio = zeroCount / bytes.length;
    const alignedRatio = Math.max(evenZeroCount, oddZeroCount) / zeroCount;
    if (zeroRatio >= 0.2 && alignedRatio >= 0.8) {
      return evenZeroCount > oddZeroCount ? 'utf-16be' : 'utf-16le';
    }
  }

  const utf8Decoded = tryDecode(bytes, 'utf-8');
  if (utf8Decoded !== null) {
    return 'utf-8';
  }

  if (isLikelyText(bytes)) {
    const utf16leDecoded = tryDecode(bytes, 'utf-16le');
    const utf16beDecoded = tryDecode(bytes, 'utf-16be');
    const windows1252Decoded = tryDecode(bytes, 'windows-1252');
    const iso88591Decoded = tryDecode(bytes, 'iso-8859-1');

    const candidates: Array<{ encoding: FileEncoding; score: number }> = [];
    if (utf16leDecoded !== null) {
      candidates.push({ encoding: 'utf-16le', score: scoreDecodedText(utf16leDecoded) });
    }
    if (utf16beDecoded !== null) {
      candidates.push({ encoding: 'utf-16be', score: scoreDecodedText(utf16beDecoded) });
    }
    if (windows1252Decoded !== null) {
      candidates.push({ encoding: 'windows-1252', score: scoreDecodedText(windows1252Decoded) });
    }
    if (iso88591Decoded !== null) {
      candidates.push({ encoding: 'iso-8859-1', score: scoreDecodedText(iso88591Decoded) });
    }

    candidates.sort((left, right) => right.score - left.score);
    if (candidates.length > 0 && candidates[0].score > 0) {
      return candidates[0].encoding;
    }
  }

  return 'binary';
}

export function decodeFileBytes(bytes: Uint8Array, encoding: FileEncoding): string {
  if (encoding === 'binary') {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(' ');
  }

  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

export function normalizeFileBytes(bytes: Uint8Array, encoding: FileEncoding): Uint8Array {
  if (encoding === 'binary') {
    return bytes;
  }

  const decoded = decodeFileBytes(bytes, encoding);
  return new TextEncoder().encode(decoded);
}

export function getEncodingLabel(encoding: FileEncoding): string {
  return ENCODING_OPTIONS.find(option => option.value === encoding)?.label ?? encoding;
}
