import { Text } from '@/components/core/Typography';

/** The muted tone every summary term is drawn in, unless a caller needs it louder. */
const DEFAULT_TERM_COLOR = 'text-muted-foreground';

export interface DefinitionEntryProps {
  readonly term: string;
  readonly value: string;
  /** The term's colour, so a caller can tone one summary differently from another. */
  readonly termColor?: string;
}

/**
 * One term/value pair for a `<dl>` grid — the read-only summaries on the ranking surfaces.
 *
 * WHY a component rather than a helper per page: a pair is a `<dt>`/`<dd>` plus two text scales,
 * and a second copy of that is a second place for one of them to drift out of the definition list
 * it has to sit in. The caller supplies the `<Grid as="dl">` around it, because how many columns a
 * summary wants is a property of that summary.
 */
export function DefinitionEntry({
  term,
  value,
  termColor = DEFAULT_TERM_COLOR,
}: DefinitionEntryProps): React.JSX.Element {
  return (
    <div>
      {/* Not `variant="label"`: that is uppercase with wide tracking, which is emphasis English can
          express and Thai cannot, so the two languages would not read as the same list. */}
      <Text as="dt" variant="small" color={termColor} className="font-medium">
        {term}
      </Text>
      <Text as="dd" variant="small" className="text-foreground/80">
        {value}
      </Text>
    </div>
  );
}
