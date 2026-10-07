import { upsertTomlValue } from '@/lib/discord-webhook';

// The active contest lives in exactly one place: config.toml [contest] CONTEST_ID.
// It used to be mirrored into .env.contest as ACTIVE_CONTEST_ID + CONTEST_ID, which is
// the class of bug ./cms config sync (and update-server, which runs it on deploy)
// exposes: a value written to a generated file is not the source of truth. Compose
// interpolates ${CONTEST_ID} from the generated .env, so CONTEST_ID is the one setting
// and this module is the only reader/writer of it — no second writable source.
export const CONTEST_SECTION = 'contest';
export const CONTEST_ID_KEY = 'CONTEST_ID';

// Scoped to the [contest] section so a same-named key elsewhere cannot be picked up,
// and quote/comment tolerant so both `CONTEST_ID = 1  # num` and `CONTEST_ID = "1"`
// (the form upsertTomlValue emits) round-trip.
const CONTEST_ID_RE = /^(\[contest\][\s\S]*?CONTEST_ID\s*=\s*)"?(\d+)"?(.*)$/m;

/** Reads the active contest id from config.toml content; null when absent or non-numeric. */
export function readContestId(content: string): number | null {
  const match = content.match(CONTEST_ID_RE);
  if (match === null) return null;
  return Number.parseInt(match[2], 10);
}

/**
 * Returns config.toml content with the active contest id set, leaving every other key
 * untouched. Keeps the value numeric (matching the example's `# num`) and preserves the
 * inline comment when the key already exists; inserts via the shared TOML writer when the
 * section or key is missing.
 */
export function setContestId(content: string, id: number): string {
  if (CONTEST_ID_RE.test(content)) {
    return content.replace(
      CONTEST_ID_RE,
      (_match, head: string, _old: string, tail: string) => `${head}${id}${tail}`,
    );
  }
  return upsertTomlValue(content, CONTEST_SECTION, CONTEST_ID_KEY, String(id));
}
