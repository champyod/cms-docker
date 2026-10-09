'use server';

import { revalidatePath } from 'next/cache';

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
}

const DEFAULTS: RankingAppearance = {
  title: '',
  subtitle: '',
  organisation: '',
  accessMode: 'public',
  showIdColumn: false,
  footerText: '',
  creditsText: '',
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
    footer_text: appearance.footerText || null,
    credits_text: appearance.creditsText || null,
  };
}

