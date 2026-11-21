/** Bulk testcase upload limits. They live here — not in the server action —
 * because `use server` modules may only export async functions. */
export const MAX_BULK_TESTCASES = 100;
const DEFAULT_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** Both caps are config.toml keys ([admin]) that reach this container through compose,
 * so each is read from the environment rather than held as a literal: an operator has to
 * be able to raise a limit on a running deployment without rebuilding the image.
 *
 * WHY MAX_TESTCASE_UPLOAD_BYTES sits beside PROXY_MAX_BODY_SIZE ([infra]): the nginx vhost
 * in front of this panel caps the request body, and a request the proxy refuses never
 * reaches this code — so an upload between the two limits died as a bare nginx 413 with no
 * explanation from the panel. One setting on each side lets them be compared.
 *
 * WHY every unparseable value falls back rather than being trusted: a cap that resolved
 * to NaN would compare false against every size and silently accept anything, and a
 * zero or negative cap would refuse every upload including a single empty testcase. The
 * fallback is the fail-safe for a key nobody set, never a configured deployment's value. */
function resolveUploadLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

/** Total bytes a single testcase file may occupy, from MAX_TESTCASE_FILE_BYTES. */
export const MAX_TESTCASE_FILE_BYTES = resolveUploadLimit(
  process.env.MAX_TESTCASE_FILE_BYTES,
  DEFAULT_FILE_BYTES,
);

/** Total bytes a batch of testcases may occupy, from MAX_TESTCASE_UPLOAD_BYTES. */
export const MAX_TESTCASE_UPLOAD_BYTES = resolveUploadLimit(
  process.env.MAX_TESTCASE_UPLOAD_BYTES,
  DEFAULT_UPLOAD_BYTES,
);

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
