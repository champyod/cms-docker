'use server';

import { revalidatePath } from 'next/cache';

import { Prisma } from '@prisma/client';

import { recordAudit } from '@/lib/audit';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

// The appearance lives in one row, keyed so a second can never be written by accident.
const SETTINGS_ID = 1;

export interface RankingAppearance {
  title: string;
  subtitle: string;
  organisation: string;
  accessMode: 'public' | 'protected';
  showIdColumn: boolean;
  footerText: string;
  creditsText: string;
  /// The full credit list, pretty-printed for the textarea. Empty means the vendored
  /// credits.json is still the list.
  credits: string;
}

const DEFAULTS: RankingAppearance = {
  title: '',
  subtitle: '',
  organisation: '',
  accessMode: 'public',
  showIdColumn: false,
  footerText: '',
  creditsText: '',
  credits: '',
};

/** Reads what the scoreboard shows. A row that does not exist yet is the defaults, not an error. */
export async function getRankingAppearance(): Promise<RankingAppearance> {
  await ensurePermission('ranking:read');
  const row = await prisma.ranking_settings.findUnique({ where: { id: SETTINGS_ID } });
  if (row === null) return DEFAULTS;
  return {
    title: row.title ?? '',
    subtitle: row.subtitle ?? '',
    organisation: row.organisation ?? '',
    accessMode: row.access_mode === 'protected' ? 'protected' : 'public',
    showIdColumn: readShowIdColumn(row.columns),
    footerText: row.footer_text ?? '',
    creditsText: row.credits_text ?? '',
    credits: formatCredits(row.credits),
  };
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
    revalidatePath('/[locale]/infrastructure/ranking');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * The form-shaped entry point. A progressive form has nowhere to render a returned
 * value, so a failure is re-thrown for the route's error boundary: the alternative is
 * a form that silently keeps the old appearance and tells the operator nothing.
 */
export async function submitRankingAppearance(formData: FormData): Promise<void> {
  const result = await saveRankingAppearance(formData);
  if (!result.success) {
    throw new Error(result.error ?? 'the appearance could not be saved');
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

function formatCredits(value: unknown): string {
  return value === null || value === undefined ? '' : JSON.stringify(value, null, 2);
}

/** Only a real boolean turns the id column on: a missing or mistyped value must not show ids. */
function readShowIdColumn(columns: unknown): boolean {
  if (typeof columns !== "object" || columns === null) return false;
  const value = (columns as Record<string, unknown>).show_id_column;
  return value === true;
}

function readForm(formData: FormData): RankingAppearance {
  const text = (name: string) => String(formData.get(name) ?? '').trim();
  return {
    title: text("title"),
    credits: String(formData.get("credits") ?? ''),
    subtitle: text("subtitle"),
    organisation: text("organisation"),
    accessMode: formData.get("accessMode") === "protected" ? "protected" : "public",
    showIdColumn: formData.get("showIdColumn") === "on",
    footerText: text("footerText"),
    creditsText: text("creditsText"),
  };
}

function toRow(appearance: RankingAppearance) {
  return {
    title: appearance.title || null,
    subtitle: appearance.subtitle || null,
    organisation: appearance.organisation || null,
    access_mode: appearance.accessMode,
    columns: { show_id_column: appearance.showIdColumn },
    credits: parseCredits(appearance.credits),
    footer_text: appearance.footerText || null,
    credits_text: appearance.creditsText || null,
  };
}

