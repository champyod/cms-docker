'use server';

import { revalidatePath } from 'next/cache';

import { Prisma, type ranking_settings } from '@prisma/client';

import { recordAudit } from '@/lib/audit';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import {
  assertWordingHasContest,
  parseContestId,
  readWording,
  wordingOverrides,
  type WordingFields,
} from '@/lib/ranking-appearance';

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
  contestId: '',
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
  const row = await prisma.ranking_settings.findUnique({ where: { id: SETTINGS_ID } });
  if (row === null) return DEFAULTS;
  return toAppearance(row);
}

/** The stored row as the form reads it, so a write can answer with what it actually kept. */
function toAppearance(row: RankingSettingsRow): RankingAppearance {
  const contestId = row.contest_id === null ? '' : String(row.contest_id);
  const wording = readWording(row.wording_overrides, contestId);
  return {
    contestId,
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
 */
export async function updateRankingAppearance(
  fields: AppearanceFields,
): Promise<RankingAppearanceSave> {
  await ensurePermission('ranking:appearance');
  try {
    const row = toRow(fields);
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
    return { success: true, appearance: toAppearance(stored) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'the appearance could not be saved',
    };
  }
}

export async function saveRankingAppearance(formData: FormData): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('ranking:appearance');
  try {
    const appearance = readForm(formData);
    const row = toRow(appearance);
    await prisma.ranking_settings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...row },
      update: row,
    });
    await recordAudit({
      verb: 'ranking:appearance:update',
      entity: 'ranking',
      entityId: String(SETTINGS_ID),
      afterValues: { ...appearance },
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

function readForm(formData: FormData): AppearanceFields {
  const text = (name: string) => String(formData.get(name) ?? '').trim();
  return {
    contestId: text("contestId"),
    title: text("title"),
    subtitle: text("subtitle"),
    organisation: text("organisation"),
    displayName: text("displayName"),
    accessMode: formData.get("accessMode") === "protected" ? "protected" : "public",
    showIdColumn: formData.get("showIdColumn") === "on",
    anonymous: formData.get("anonymous") === "on",
    footerText: text("footerText"),
    creditsText: text("creditsText"),
    theme: text("theme"),
    scoreFormat: text("scoreFormat"),
    perspectives: text("perspectives"),
  };
}

function toRow(appearance: AppearanceFields) {
  const contestId = parseContestId(appearance.contestId);
  assertWordingHasContest(appearance, contestId);
  return {
    // The contest is named, not copied: the board reads its name and dates from the projected
    // record, and the legacy title/subtitle columns are left as they are rather than written
    // again as a second source of the same words.
    contest_id: contestId,
    wording_overrides: toJsonColumn(wordingOverrides(appearance)),
    organisation: appearance.organisation || null,
    display_name: appearance.displayName || null,
    access_mode: appearance.accessMode,
    columns: { show_id_column: appearance.showIdColumn, anonymous: appearance.anonymous },
    footer_text: appearance.footerText || null,
    credits_text: appearance.creditsText || null,
    theme: parseJsonObject('the theme', appearance.theme),
    score_format: parseJsonObject('the score format', appearance.scoreFormat),
    perspectives: parsePerspectives(appearance.perspectives),
  };
}
