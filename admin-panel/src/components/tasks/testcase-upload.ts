import JSZip from 'jszip';
import { buildPairs, readBlobBytes } from './testcase-helpers';
import type { FilePair, SourceItem } from './testcase-helpers';

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
