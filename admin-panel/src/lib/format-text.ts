/** One wording for the database's underscore-separated enum values. */
export function humanizeEnum(value: string): string {
  return value.replace(/_/g, ' ');
}
