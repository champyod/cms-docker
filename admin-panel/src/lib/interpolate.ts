/**
 * Fills `{name}` placeholders in a dictionary string.
 *
 * Why it exists: the dictionaries already write parameters as `{permission}` and `{total}`, but each
 * consumer filled them with its own chained `String.replace`, which silently keeps the braces when a
 * parameter is forgotten. This is the one filler for copy that has more than one parameter.
 * An unknown name is left as-is so a missing value stays visible instead of printing "undefined".
 */
export function interpolate(
  template: string,
  values: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}
