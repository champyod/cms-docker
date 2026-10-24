/**
 * Who filed a ranking row — or that nobody did.
 *
 * WHY one module: the override list marks the rows it cannot name and the hides surface marks the
 * hides it cannot attribute, and both are reading the same recorded-at-write column. A second
 * spelling of "no actor was recorded" would let the two surfaces disagree about which rows were
 * written outside the panel, which is the defect these marks exist to remove.
 *
 * `created_by` is nullable on `ranking_overrides`, so a row filed by hand, by an import or by the
 * classic admin carries no author at all. That is not a rendering accident to be shown as "—": it
 * is the fact that the write happened outside the panel, and it has to read as one.
 */
export interface AttributedRow {
  readonly createdBy: number | null;
  readonly createdByName: string | null;
}

/** Whether a row records no author: it was written outside the panel, not by an unnamed one. */
export function isUnattributed(row: AttributedRow): boolean {
  return row.createdBy === null;
}

/**
 * The author as the operator reads it, or `null` when the row carries none.
 *
 * WHY a fallback to `#id`: an admin deleted after filing leaves an id and no name, and the id is
 * still the attribution — dropping it to `null` would make an attributed row look unattributed.
 */
export function attributionText(row: AttributedRow): string | null {
  if (row.createdBy === null) return null;
  return row.createdByName ?? `#${row.createdBy}`;
}
