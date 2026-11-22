import { StatCard, type StatCardProps } from '@/components/core/StatCard';

/**
 * The headline numbers of a page, as one set.
 *
 * A grid of cards is a set of facts, so it is announced as a list and its column policy is decided
 * here: two pages that choose their own grid end up disagreeing about how wide a metric is, which
 * is the kind of difference a reader notices without being able to name.
 */
export function StatGrid({
  totals,
  locale,
  className,
}: {
  readonly totals: readonly StatCardProps[];
  readonly locale?: string;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <ul className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 ${className ?? ''}`}>
      {totals.map((total) => (
        <li key={total.label} className="min-w-0">
          <StatCard {...total} locale={total.locale ?? locale} />
        </li>
      ))}
    </ul>
  );
}
