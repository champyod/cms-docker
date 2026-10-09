/** Bulk testcase upload limits. They live here — not in the server action —
 * because `use server` modules may only export async functions. */
export const MAX_BULK_TESTCASES = 100;
export const MAX_TESTCASE_FILE_BYTES = 2_097_152;
const DEFAULT_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** Total bytes a batch of testcases may occupy, from MAX_TESTCASE_UPLOAD_BYTES in
 * config.toml [admin]. WHY it is configurable: the nginx vhost in front of this panel
 * caps the request body at PROXY_MAX_BODY_SIZE, and a request the proxy refuses never
 * reaches this code — so an upload between the two limits died as a bare nginx 413 with
 * no explanation from the panel. One setting on each side lets them be compared.
 * WHY every unparseable value falls back rather than being trusted: a cap that resolved
 * to NaN would compare false against every size and silently accept anything, and a
 * zero or negative cap would refuse every upload including a single empty testcase. */
function resolveUploadLimit(raw: string | undefined): number {
  const parsed = Number(raw?.trim());
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_UPLOAD_BYTES;
  }
  return Math.floor(parsed);
}

export const MAX_TESTCASE_UPLOAD_BYTES = resolveUploadLimit(process.env.MAX_TESTCASE_UPLOAD_BYTES);

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
