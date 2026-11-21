export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function labelMatches(label: string, needle: string): boolean {
  if (needle.length === 0) return true;
  return label.toLowerCase().includes(needle);
}

export function filterPaletteRows<T>(rows: readonly T[], needle: string, labelOf: (row: T) => string): T[] {
  if (needle.length === 0) return [...rows];

  const prefixed: T[] = [];
  const contained: T[] = [];

  for (const row of rows) {
    const label = labelOf(row).toLowerCase();
    if (label.startsWith(needle)) prefixed.push(row);
    else if (label.includes(needle)) contained.push(row);
  }

  return [...prefixed, ...contained];
}
