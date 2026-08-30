import { detectFileEncoding } from '@/lib/file-encoding';
import type { FileEncoding } from '@/lib/file-encoding';
import { parseFilename } from '@/utils/filenameParser';
import { readBytesAsBase64 } from '@/lib/file-helpers';
import { normalizeFileBytes } from '@/lib/file-encoding';

export interface EncodedFile {
  name: string;
  bytes: Uint8Array;
  detectedEncoding: FileEncoding;
  selectedEncoding: FileEncoding;
}

export interface FilePair {
  id: string;
  inputFile?: EncodedFile;
  outputFile?: EncodedFile;
  status: 'ready' | 'missing_output' | 'missing_input' | 'error';
}

export interface SourceItem {
  name: string;
  getBytes: () => Promise<Uint8Array>;
}

export function createEncodedFile(name: string, bytes: Uint8Array): EncodedFile {
  const detectedEncoding = detectFileEncoding(bytes);
  return { name, bytes, detectedEncoding, selectedEncoding: detectedEncoding };
}

export async function buildPairs(sourceItems: SourceItem[], inputPattern: string, outputPattern: string): Promise<FilePair[]> {
  const pairMap: Record<string, Partial<FilePair>> = {};
  for (const item of sourceItems) {
    const bytes = await item.getBytes();
    const inputId = parseFilename(item.name, inputPattern);
    const outputId = parseFilename(item.name, outputPattern);
    if (inputId) {
      if (!pairMap[inputId]) pairMap[inputId] = { id: inputId };
      pairMap[inputId].inputFile = createEncodedFile(item.name, bytes);
    } else if (outputId) {
      if (!pairMap[outputId]) pairMap[outputId] = { id: outputId };
      pairMap[outputId].outputFile = createEncodedFile(item.name, bytes);
    }
  }
  return Object.values(pairMap)
    .map((pair) => {
      const resolved = pair as FilePair;
      if (!resolved.inputFile) resolved.status = 'missing_input';
      else if (!resolved.outputFile) resolved.status = 'missing_output';
      else resolved.status = 'ready';
      return resolved;
    })
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
}

export async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function pairToUploadData(pair: FilePair): Promise<{ codename: string; inputBase64: string; outputBase64: string; isPublic: boolean }> {
  if (!pair.inputFile || !pair.outputFile) throw new Error(`Pair ${pair.id} is missing input or output data`);
  return {
    codename: pair.id,
    inputBase64: await readBytesAsBase64(normalizeFileBytes(pair.inputFile.bytes, pair.inputFile.selectedEncoding)),
    outputBase64: await readBytesAsBase64(normalizeFileBytes(pair.outputFile.bytes, pair.outputFile.selectedEncoding)),
    isPublic: false,
  };
}
