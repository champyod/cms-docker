/** Bulk testcase upload limits. They live here — not in the server action —
 * because `use server` modules may only export async functions. */
export const MAX_BULK_TESTCASES = 100;
export const MAX_TESTCASE_FILE_BYTES = 2_097_152;
export const MAX_TESTCASE_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export function formatByteLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

/** Rejects oversized requests from the Content-Length header before the body is buffered; a missing or invalid header defers to post-parse validation. */
export function isRequestBodyTooLarge(contentLengthHeader: string | null): boolean {
  if (contentLengthHeader === null) {
    return false;
  }
  const contentLength = Number(contentLengthHeader);
  if (!Number.isFinite(contentLength)) {
    return false;
  }
  return contentLength > MAX_TESTCASE_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES;
}
