import { describe, expect, it } from 'vitest';
import {
  decodeFileBytes,
  detectFileEncoding,
  getEncodingLabel,
  normalizeFileBytes,
} from '@/lib/file-encoding';

const utf16leBytes = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }
  return bytes;
};

const utf16beBytes = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index * 2] = code >> 8;
    bytes[index * 2 + 1] = code & 0xff;
  }
  return bytes;
};

describe('detectFileEncoding', () => {
  it('defaults empty input to utf-8', () => {
    expect(detectFileEncoding(new Uint8Array(0))).toBe('utf-8');
  });

  it('detects BOM-prefixed encodings', () => {
    expect(detectFileEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('utf-8');
    expect(detectFileEncoding(new Uint8Array([0xff, 0xfe, 0x68, 0x00]))).toBe('utf-16le');
    expect(detectFileEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x68]))).toBe('utf-16be');
  });

  it('detects plain ASCII as utf-8', () => {
    expect(detectFileEncoding(new TextEncoder().encode('hello world\n'))).toBe('utf-8');
  });

  it('detects BOM-less UTF-16 via zero-alignment heuristic', () => {
    expect(detectFileEncoding(utf16leBytes('Hello'))).toBe('utf-16le');
    expect(detectFileEncoding(utf16beBytes('Hello'))).toBe('utf-16be');
  });

  it('falls back to binary for non-textual bytes', () => {
    expect(detectFileEncoding(new Uint8Array([0x81, 0x81, 0x81, 0x81]))).toBe('binary');
  });
});

describe('decodeFileBytes', () => {
  it('renders binary as space-separated hex', () => {
    expect(decodeFileBytes(new Uint8Array([72, 105]), 'binary')).toBe('48 69');
  });

  it('decodes utf-8 text', () => {
    const bytes = new TextEncoder().encode('héllo');
    expect(decodeFileBytes(bytes, 'utf-8')).toBe('héllo');
  });

  it('decodes utf-16le with replacement instead of throwing', () => {
    expect(decodeFileBytes(utf16leBytes('Hi'), 'utf-16le')).toBe('Hi');
  });
});

describe('normalizeFileBytes', () => {
  it('passes binary through untouched', () => {
    const bytes = new Uint8Array([0x81, 0x82]);
    expect(normalizeFileBytes(bytes, 'binary')).toBe(bytes);
  });

  it('re-encodes other encodings as utf-8', () => {
    const normalized = normalizeFileBytes(utf16leBytes('Hi'), 'utf-16le');
    expect(Array.from(normalized)).toEqual([0x48, 0x69]);
  });
});

describe('getEncodingLabel', () => {
  it('returns the human label for known encodings', () => {
    expect(getEncodingLabel('utf-8')).toBe('UTF-8');
    expect(getEncodingLabel('utf-16le')).toBe('UTF-16 LE');
    expect(getEncodingLabel('binary')).toBe('Raw bytes');
  });

  it('falls back to the raw value for unknown encodings', () => {
    expect(getEncodingLabel('klingon' as never)).toBe('klingon');
  });
});
