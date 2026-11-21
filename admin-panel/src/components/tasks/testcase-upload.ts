import JSZip from 'jszip';
import { normalizeFileBytes } from '@/lib/file-encoding';
import { buildPairs, readBlobBytes } from './testcase-helpers';
import type { EncodedFile, FilePair, SourceItem } from './testcase-helpers';

export async function pairLocalFiles(files: File[], inputPattern: string, outputPattern: string): Promise<FilePair[]> {
  const sourceItems: SourceItem[] = files.map((file) => ({ name: file.name, getBytes: () => readBlobBytes(file) }));
  return buildPairs(sourceItems, inputPattern, outputPattern);
}

export async function pairZipFile(file: File, inputPattern: string, outputPattern: string): Promise<FilePair[]> {
  const zip = new JSZip();
  const content = await zip.loadAsync(file);
  const sourceItems: SourceItem[] = [];
  for (const [filename, zipEntry] of Object.entries(content.files)) {
    if (zipEntry.dir || filename.startsWith('__MACOSX')) continue;
    const cleanName = filename.split('/').pop() ?? filename;
    sourceItems.push({ name: cleanName, getBytes: async () => zipEntry.async('uint8array') });
  }
  return buildPairs(sourceItems, inputPattern, outputPattern);
}

function toUploadFile(file: EncodedFile): File {
  const bytes = normalizeFileBytes(file.bytes, file.selectedEncoding);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], file.name);
}

export function buildUploadFormData(pairs: FilePair[], datasetId: number): FormData {
  const formData = new FormData();
  formData.append('datasetId', String(datasetId));
  formData.append('count', String(pairs.length));
  for (const [index, pair] of pairs.entries()) {
    if (!pair.inputFile || !pair.outputFile) continue;
    formData.append(`codename-${index}`, pair.id);
    formData.append(`input-${index}`, toUploadFile(pair.inputFile));
    formData.append(`output-${index}`, toUploadFile(pair.outputFile));
  }
  return formData;
}
