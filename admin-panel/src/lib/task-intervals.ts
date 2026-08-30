export type PostgresInterval = {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
};

export function parseIntervalToSeconds(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    const parts = val.split(':').map(Number);
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return undefined;
  }
  if (typeof val === 'object') {
    const obj = val as PostgresInterval;
    let total = 0;
    if (obj.days !== undefined) total += obj.days * 24 * 3600;
    if (obj.hours !== undefined) total += obj.hours * 3600;
    if (obj.minutes !== undefined) total += obj.minutes * 60;
    if (obj.seconds !== undefined) total += obj.seconds;
    return total;
  }
  return undefined;
}

export type IntervalFieldMap = Record<string, unknown>;

export function addIntervalClause(
  setClauses: string[],
  params: unknown[],
  intervalFields: IntervalFieldMap,
  key: string,
  unit: string
): void {
  const value = intervalFields[key];
  if (value === undefined) return;
  if (value === null) {
    setClauses.push(`${key} = NULL`);
    return;
  }
  params.push(`${value} ${unit}`);
  setClauses.push(`${key} = $${params.length}::interval`);
}
