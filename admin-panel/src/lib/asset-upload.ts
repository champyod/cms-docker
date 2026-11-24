/** Every cap reads from the environment so an operator raises a limit without rebuilding; the fallback is a fail-safe, never the intended value. */
import { MAX_TESTCASE_FILE_BYTES } from '@/lib/testcase-limits';

export type AssetKind = 'logo' | 'avatar' | 'statement' | 'attachment' | 'testcase';

/** The config.toml key each cap arrives on, and the value used only if it is unusable. */
const CAP_SOURCES: Readonly<Record<Exclude<AssetKind, 'testcase'>, { key: string; fallback: number }>> = {
  logo: { key: 'MAX_LOGO_UPLOAD_BYTES', fallback: 5 * 1024 * 1024 },
  avatar: { key: 'MAX_AVATAR_UPLOAD_BYTES', fallback: 2 * 1024 * 1024 },
  statement: { key: 'MAX_STATEMENT_UPLOAD_BYTES', fallback: 10 * 1024 * 1024 },
  attachment: { key: 'MAX_ATTACHMENT_UPLOAD_BYTES', fallback: 10 * 1024 * 1024 },
};

function resolveCap(source: { key: string; fallback: number }): number {
  const raw = process.env[source.key];
  const parsed = Number(raw?.trim());
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
    return source.fallback;
  }
  return Math.floor(parsed);
}

/** The largest single file of each kind the panel accepts, in bytes. */
export const ASSET_MAX_BYTES: Readonly<Record<AssetKind, number>> = {
  logo: resolveCap(CAP_SOURCES.logo),
  avatar: resolveCap(CAP_SOURCES.avatar),
  statement: resolveCap(CAP_SOURCES.statement),
  attachment: resolveCap(CAP_SOURCES.attachment),
  testcase: MAX_TESTCASE_FILE_BYTES,
};

/** The image formats both the ranking logo and a contestant face accept, in probe order. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'gif', 'bmp'] as const;
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

const IMAGE_MIME: Readonly<Record<ImageExtension, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/** The refusal a file over its kind's cap gets, or null when it fits. */
export function validateAssetSize(kind: AssetKind, bytes: number): string | null {
  const maxBytes = ASSET_MAX_BYTES[kind];
  if (bytes === 0) return 'Empty file';
  if (bytes > maxBytes) return `File too large: max ${formatByteLimit(maxBytes)}`;
  return null;
}

/** Strips the dot, lowercases, folds .jpeg onto .jpg: one spelling per kind. */
export function normalizeImageExtension(raw: string): ImageExtension | null {
  const lower = raw.toLowerCase().replace(/^\./, '');
  const mapped = lower === 'jpeg' ? 'jpg' : lower;
  return (IMAGE_EXTENSIONS as readonly string[]).includes(mapped)
    ? (mapped as ImageExtension)
    : null;
}

export function imageMime(extension: ImageExtension): string {
  return IMAGE_MIME[extension];
}

function formatByteLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}
