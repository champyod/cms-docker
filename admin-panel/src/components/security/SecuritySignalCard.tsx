import Link from 'next/link';

import { Badge } from '@/components/core/Badge';
import { Card } from '@/components/core/Card';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import { SIGNAL_RULES, type SecurityDigest, type SignalTone } from '@/lib/security/signal';

type SignalCopy = Dictionary['security']['signal'];

interface SecuritySignalCardProps {
  readonly digest: SecurityDigest;
  readonly locale: string;
  readonly copy: SignalCopy;
}

const TONE_VARIANT: Record<SignalTone, 'red' | 'amber' | 'cyan' | 'emerald'> = {
  act: 'red',
  unevaluable: 'amber',
  watch: 'cyan',
  clear: 'emerald',
};

function fill(template: string, values: Record<string, number>): string {
  return Object.entries(values).reduce(
    (line, [key, value]) => line.replace(`{${String(key)}}`, String(value)),
    template,
  );
}

/** Server-rendered from the read path's own digest, so the card cannot disagree with the patching page. */
export function SecuritySignalCard({ digest, locale, copy }: SecuritySignalCardProps): React.JSX.Element {
  const counts = [
    { key: 'unwaivedCritical', label: copy.counts.unwaivedCritical, value: digest.counts.unwaivedCritical },
    { key: 'unwaivedHigh', label: copy.counts.unwaivedHigh, value: digest.counts.unwaivedHigh },
    { key: 'expiredWaivers', label: copy.counts.expiredWaivers, value: digest.counts.expiredWaivers },
    {
      key: 'expiringWaivers',
      label: fill(copy.counts.expiringWaivers, { days: SIGNAL_RULES.waiverWarningDays }),
      value: digest.counts.expiringWaivers,
    },
    {
      key: 'agedFindings',
      label: fill(copy.counts.agedFindings, { days: SIGNAL_RULES.findingAgeDays }),
      value: digest.counts.agedFindings,
    },
  ].filter((count) => count.value > 0);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{copy.title}</h2>
          <Badge variant={TONE_VARIANT[digest.tone]}>{copy.tone[digest.tone]}</Badge>
        </div>
        <Link className="text-sm underline underline-offset-4" href={buildRoute(locale, 'security.patching')}>
          {copy.detail}
        </Link>
      </div>

      {counts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.clear}</p>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {counts.map((count) => (
            <div key={count.key} className="min-w-24">
              <p className="text-xs text-muted-foreground">{count.label}</p>
              <p className="font-mono text-2xl text-foreground">{String(count.value)}</p>
            </div>
          ))}
        </div>
      )}

      {digest.worst !== null && (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">{copy.worst}: </span>
          <span className="font-mono">{digest.worst.label}</span>
          <span className="text-muted-foreground">: {digest.worst.detail}</span>
        </p>
      )}

      {digest.oldest !== null && digest.oldest.ageDays !== null && (
        <p className="text-sm">
          <span className="text-muted-foreground">{copy.oldest}: </span>
          <span className="font-mono">{digest.oldest.label}</span>
          <span className="text-muted-foreground">
            {': '}
            {fill(copy.ageDays, { days: digest.oldest.ageDays })}
          </span>
        </p>
      )}

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {digest.staleness.map((reading) => (
          <div key={reading.channel} className="flex gap-2">
            <dt className="text-muted-foreground">{copy.channel[reading.channel]}:</dt>
            <dd>
              <span className={reading.state === 'current' ? 'text-foreground' : 'text-destructive'}>
                {copy.state[reading.state]}
              </span>
              {reading.state === 'current' && reading.ageSeconds !== null && (
                <span className="text-muted-foreground">
                  {' '}
                  {fill(copy.ageHours, { hours: Math.round(reading.ageSeconds / 3600) })}
                </span>
              )}
              {reading.state !== 'current' && reading.detail !== null && (
                <span className="text-muted-foreground">: {reading.detail}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {digest.counts.unevaluable > 0 && (
        // A reading that could not be taken is not a healthy reading, and this card says so in words.
        <p className="mt-2 text-xs text-destructive">{copy.unreadable}</p>
      )}
    </Card>
  );
}
