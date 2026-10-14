import { withBasePath } from '@/lib/base-path';

const UTF8_BOM = '\uFEFF';

function triggerDownload(href: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.setAttribute('download', filename);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/** Saves generated text as a CSV; the BOM keeps Thai text readable in Excel and LibreOffice. */
export function downloadCsvFile(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([UTF8_BOM + content], { type: 'text/csv;charset=utf-8;' }));
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}

/** Opens a CSV the server already holds behind a token instead of copying its bytes into the page. */
export function openServerDownload(downloadUrl: string, filename: string): void {
  triggerDownload(withBasePath(downloadUrl), filename);
}
