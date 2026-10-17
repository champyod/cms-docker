'use server';

import { revalidatePath } from 'next/cache';

import { Prisma, type ranking_settings } from '@prisma/client';

import { recordAudit } from '@/lib/audit';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import {
  assertWordingHasContest,
  readWording,
  wordingOverrides,
  type WordingFields,
} from '@/lib/ranking-appearance';
import { readShownContestId } from '@/lib/ranking-shown';

// The appearance lives in one row, keyed so a second can never be written by accident.
const SETTINGS_ID = 1;

/** The perspective tabs the page registers. Kept in step with the crate's registry
 * (ranking-web/src/perspectives.rs) so a tab the panel accepts is one the board can
 * draw; a unit test fails when the two lists drift. */
const PERSPECTIVE_IDS: readonly string[] = ["board", "teams", "tasks", "scores", "progress", "time", "group", "metrics", "analysis"];
const OVERFLOW_MODES: readonly string[] = ["wrap", "scroll", "menu"];

/** The appearance columns the board reads. The credit list is edited on its own. */
export interface AppearanceFields extends WordingFields {
  organisation: string;
  /** Short display name shown below the logo on ranking board. Falls back to title if empty. */
  displayName: string;
  accessMode: 'public' | 'protected';
  showIdColumn: boolean;
  anonymous: boolean;
  footerText: string;
  creditsText: string;
  theme: string;
  scoreFormat: string;
  perspectives: string;
}

export interface RankingAppearance extends AppearanceFields {
  /// The full credit list, pretty-printed for the textarea. Empty means the vendored
  /// credits.json is still the list.
  credits: string;
}

const DEFAULTS: RankingAppearance = {
  title: '',
  subtitle: '',
  organisation: '',
  displayName: '',
  accessMode: 'public',
  showIdColumn: false,
  anonymous: false,
  footerText: '',
  creditsText: '',
  credits: '',
  theme: '',
  scoreFormat: '',
  perspectives: '',
};

/** Reads what the scoreboard shows. A row that does not exist yet is the defaults, not an error. */
export async function getRankingAppearance(): Promise<RankingAppearance> {
  await ensurePermission('ranking:read');
  const [row, contestId] = await Promise.all([
    prisma.ranking_settings.findUnique({ where: { id: SETTINGS_ID } }),
    readShownContestId(),
  ]);
  if (row === null) return DEFAULTS;
  return toAppearance(row, contestId);
}

/** The stored row as the form reads it, so a write can answer with what it actually kept. */
function toAppearance(row: RankingSettingsRow, contestId: number | null): RankingAppearance {
  // The header words belong to the contest the config shows: the row keys its override by that
  // contest, so a contest named anywhere else would be a second representation of the shown set.
  const wording = readWording(row.wording_overrides, contestId);
  return {
    title: wording.title,
    subtitle: wording.subtitle,
    organisation: row.organisation ?? '',
    displayName: row.display_name ?? '',
    accessMode: row.access_mode === 'protected' ? 'protected' : 'public',
    showIdColumn: readShowIdColumn(row.columns),
    anonymous: readAnonymous(row.columns),
    footerText: row.footer_text ?? '',
    creditsText: row.credits_text ?? '',
    credits: formatJson(row.credits),
    theme: formatJson(row.theme),
    scoreFormat: formatJson(row.score_format),
    perspectives: formatJson(row.perspectives),
  };
}

type RankingSettingsRow = ranking_settings;

/** A write that either stored the row or has a reason it did not. */
export type RankingAppearanceSave =
  | { readonly success: true; readonly appearance: RankingAppearance }
  | { readonly success: false; readonly error: string };

/**
 * The appearance page's entry point. The page holds its fields as form state, so it hands
 * the object it already has rather than a FormData, and the row the write kept comes back
 * with it: that is what the page re-seeds from, and only after the write succeeded.
 *
 * WHY the object type is the whole field set: this is the surface that owns every appearance
 * column, so the object it hands states them all and the write touches them all. A form that
 * owns one setting posts a FormData through `saveRankingAppearance` instead, where only the
 * fields actually posted are written.
 */
export async function updateRankingAppearance(
  fields: AppearanceFields,
): Promise<RankingAppearanceSave> {
  await ensurePermission('ranking:appearance');
  try {
    const contestId = await readShownContestId();
    const row = toRow(fields, contestId);
    const stored = await prisma.ranking_settings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...row },
      update: row,
    });
    await recordAudit({
      verb: 'ranking:appearance:update',
      entity: 'ranking',
      entityId: String(SETTINGS_ID),
      afterValues: { ...fields },
      result: 'success',
    });
    revalidatePath('/[locale]/ranking/appearance');
    return { success: true, appearance: toAppearance(stored, contestId) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'the appearance could not be saved',
    };
  }
}

/**
 * The FormData entry point, for a control that owns only some of the appearance columns — the
 * System page's access-mode card posts the access mode and nothing else.
 *
 * WHY the post is read as the set of settings the caller owns rather than as the row: a control
 * that owns one setting must never be able to clear the others, so a field the post leaves out
 * is a column this write leaves alone. Clearing a column is stated explicitly — the field is
 * posted empty — which is why the mapping to a row is the same one `updateRankingAppearance`
 * uses (see `toRow`).
 */
export async function saveRankingAppearance(formData: FormData): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('ranking:appearance');
  try {
    const stated = readForm(formData);
    const row = toRow(stated, await readShownContestId());
    await prisma.ranking_settings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...row },
      update: row,
    });
    await recordAudit({
      verb: 'ranking:appearance:update',
      entity: 'ranking',
      entityId: String(SETTINGS_ID),
      afterValues: { ...stated },
      result: 'success',
    });
    revalidatePath('/[locale]/ranking/appearance');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * The credit list is saved apart from the appearance columns because the two now live on
 * separate pages: one form saving both means the field a page no longer posts writes an
 * empty list over the one already stored, and for a licence offer that is worse than a refusal.
 */
export async function saveRankingCredits(formData: FormData): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('ranking:appearance');
  try {
    const raw = String(formData.get('credits') ?? '');
    const credits = parseCredits(raw);
    await prisma.ranking_settings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, credits },
      update: { credits },
    });
    await recordAudit({
      verb: 'ranking:credits:update',
      entity: 'ranking',
      entityId: String(SETTINGS_ID),
      afterValues: { credits: raw },
      result: 'success',
    });
    revalidatePath('/[locale]/ranking/credits');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/** The credit list's form-shaped entry point, mirroring submitRankingAppearance. */
export async function submitRankingCredits(formData: FormData): Promise<void> {
  const result = await saveRankingCredits(formData);
  if (!result.success) {
    throw new Error(result.error ?? 'the credit list could not be saved');
  }
}

/**
 * The panel's list replaces the vendored one, so it is parsed and shape-checked here: a
 * credit entry with no name would render as an anonymous asset in a licence offer.
 */
function parseCredits(raw: string): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const trimmed = raw.trim();
  if (trimmed === "") {
    // Prisma distinguishes a JSON null from SQL NULL; an emptied box means SQL NULL, so
    // the vendored credits.json is served again rather than an empty list.
    return Prisma.JsonNull;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("the credit list must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length > 100) {
    throw new Error("the credit list must be an array of at most 100 entries");
  }
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null || typeof (entry as { name?: unknown }).name !== "string") {
      throw new Error("every credit entry needs a name");
    }
  }
  return parsed as Prisma.InputJsonValue;
}

function formatJson(value: unknown): string {
  return value === null || value === undefined ? '' : JSON.stringify(value, null, 2);
}

/**
 * Prisma tells a JSON null from SQL NULL, and an absent override is the JSON one: an emptied
 * override must not read back as a stored map.
 */
function toJsonColumn(
  value: Prisma.InputJsonValue | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value;
}

/** Shape-checks the stored config so a bad tab is an error, not a silently ignored one. */
function parsePerspectives(raw: string): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return Prisma.JsonNull;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("the perspective config must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("the perspective config must be a JSON object");
  }
  const config = parsed as Record<string, unknown>;
  assertPerspectiveTabs(config);
  assertPerspectiveLayout(config);
  if (config.default !== undefined && typeof config.default !== "string") {
    throw new Error("default must name a tab");
  }
  return parsed as Prisma.InputJsonValue;
}

function assertPerspectiveTabs(config: Record<string, unknown>): void {
  if (config.tabs === undefined) {
    return;
  }
  if (!Array.isArray(config.tabs)) {
    throw new Error("tabs must be an array");
  }
  for (const tab of config.tabs) {
    const id = tab === null ? undefined : (tab as { id?: unknown }).id;
    if (typeof id !== "string" || !PERSPECTIVE_IDS.includes(id)) {
      throw new Error(`unknown perspective tab: ${String(id)}`);
    }
  }
}

function assertPerspectiveLayout(config: Record<string, unknown>): void {
  if (config.layout === undefined) {
    return;
  }
  if (typeof config.layout !== "object" || config.layout === null) {
    throw new Error("layout must be an object");
  }
  const overflow = (config.layout as Record<string, unknown>).overflow;
  if (overflow !== undefined && (typeof overflow !== "string" || !OVERFLOW_MODES.includes(overflow))) {
    throw new Error(`unknown overflow mode: ${String(overflow)}`);
  }
}

/**
 * Theme and score format are free-form JSON objects the board reads as-is, so only the
 * shape is checked here: an emptied box unsets the column rather than storing `null`.
 */
function parseJsonObject(label: string, raw: string): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return Prisma.JsonNull;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Prisma.InputJsonValue;
}

/** Only a real boolean turns the id column on: a missing or mistyped value must not show ids. */
function readShowIdColumn(columns: unknown): boolean {
  if (typeof columns !== "object" || columns === null) return false;
  const value = (columns as Record<string, unknown>).show_id_column;
  return value === true;
}

/** Only a real boolean starts the board anonymous; the default is to show names. */
function readAnonymous(columns: unknown): boolean {
  if (typeof columns !== "object" || columns === null) return false;
  const value = (columns as Record<string, unknown>).anonymous;
  return value === true;
}

/**
 * The appearance fields a caller stated: the same shape as `AppearanceFields`, every field
 * optional. A field that is absent from this shape is one the caller never mentioned, so the
 * write leaves its column alone — see `toRow`.
 */
// `-readonly` because the wording fields are declared readonly on the shared shape (they are
// read straight off a stored row there); a caller assembling its own statement needs to set them.
type StatedAppearanceFields = { -readonly [K in keyof AppearanceFields]?: AppearanceFields[K] };

/** The fields whose post carries text; the access mode and the two display flags are read apart. */
type TextField = Exclude<keyof AppearanceFields, 'accessMode' | 'showIdColumn' | 'anonymous'>;
const TEXT_FIELDS: readonly TextField[] = [
  'title',
  'subtitle',
  'organisation',
  'displayName',
  'footerText',
  'creditsText',
  'theme',
  'scoreFormat',
  'perspectives',
];

/**
 * The fields the caller actually stated — the columns it owns, and no others.
 *
 * WHY absence means "leave it alone": a form that owns one control posts only that control,
 * and a field it never mentioned is not an instruction to clear it. Reading absence as an
 * empty value is what let the System page's *Save Access Mode* write JSON null over the
 * theme, the score format and the perspective config it never posted. A caller that *does*
 * mean to clear a column states that field empty (an emptied text or JSON box still clears,
 * see `toRow`), never by leaving it out.
 *
 * WHY the two display flags are read together: `columns` is one JSON column carrying both
 * settings, so a post that states either flag writes the column from both — an unchecked box
 * is absent from a form post by HTML's own rule, not an unstated field.
 */
function readForm(formData: FormData): StatedAppearanceFields {
  const stated: StatedAppearanceFields = {};
  for (const name of TEXT_FIELDS) {
    if (formData.has(name)) {
      stated[name] = String(formData.get(name) ?? '').trim();
    }
  }
  if (formData.has('accessMode')) {
    stated.accessMode = formData.get('accessMode') === 'protected' ? 'protected' : 'public';
  }
  if (formData.has('showIdColumn') || formData.has('anonymous')) {
    stated.showIdColumn = formData.get('showIdColumn') === 'on';
    stated.anonymous = formData.get('anonymous') === 'on';
  }
  return stated;
}

/**
 * The appearance columns a statement may write, each in a form both the create and the update
 * side of the upsert accept. A key absent from this shape is a column the write leaves alone.
 */
interface AppearanceColumns {
  wording_overrides?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  organisation?: string | null;
  display_name?: string | null;
  access_mode?: 'public' | 'protected';
  columns?: Prisma.InputJsonValue;
  footer_text?: string | null;
  credits_text?: string | null;
  theme?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  score_format?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  perspectives?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

/**
 * The columns this write states, and only those.
 *
 * WHY a partial row rather than the whole one: the fields a caller hands over are the settings
 * it owns, and a column it never mentioned must keep its stored value. Building every column
 * from a partial statement is what wrote JSON null over the theme, the score format and the
 * perspective config each time the System page saved its access mode. A caller that means to
 * clear a column states that field empty — an emptied text or JSON box still clears below,
 * which is why an explicit `''` reaches `Prisma.JsonNull` instead of being skipped.
 *
 * WHY the paired fields are written as one column each: `wording_overrides` holds the two
 * header words of the shown contest as one entry, and `columns` carries both display flags, so
 * a statement of either member writes the column from both. A caller that states neither leaves
 * both columns alone.
 */
function toRow(fields: StatedAppearanceFields, contestId: number | null): AppearanceColumns {
  const words = { title: fields.title ?? '', subtitle: fields.subtitle ?? '' };
  assertWordingHasContest(words, contestId);
  const row: AppearanceColumns = {};
  if (fields.title !== undefined || fields.subtitle !== undefined) {
    // The contest is named by the config, not copied here, and the board reads its name and dates
    // from the projected record of the contest the config shows. The words below override that
    // record's own ones; no column of this row names a contest.
    row.wording_overrides = toJsonColumn(wordingOverrides(words, contestId));
  }
  if (fields.organisation !== undefined) {
    row.organisation = fields.organisation || null;
  }
  if (fields.displayName !== undefined) {
    row.display_name = fields.displayName || null;
  }
  if (fields.accessMode !== undefined) {
    row.access_mode = fields.accessMode;
  }
  if (fields.showIdColumn !== undefined || fields.anonymous !== undefined) {
    row.columns = { show_id_column: fields.showIdColumn ?? false, anonymous: fields.anonymous ?? false };
  }
  if (fields.footerText !== undefined) {
    row.footer_text = fields.footerText || null;
  }
  if (fields.creditsText !== undefined) {
    row.credits_text = fields.creditsText || null;
  }
  if (fields.theme !== undefined) {
    row.theme = parseJsonObject('the theme', fields.theme);
  }
  if (fields.scoreFormat !== undefined) {
    row.score_format = parseJsonObject('the score format', fields.scoreFormat);
  }
  if (fields.perspectives !== undefined) {
    row.perspectives = parsePerspectives(fields.perspectives);
  }
  return row;
}
