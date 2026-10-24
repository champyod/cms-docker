'use client';

import { useMemo, useState, useTransition } from 'react';

import { createPatchingWaiver, endPatchingWaiver } from '@/app/actions/securityPatching';
import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Dialog } from '@/components/core/Dialog';
import { EmptyState } from '@/components/core/EmptyState';
import { Input } from '@/components/core/Input';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import type { Dictionary } from '@/lib/dictionary';
import type {
  PatchingFinding,
  PatchingGroup,
  PatchingState,
  PatchingWaiver,
  WaiverState,
} from '@/lib/security/patching';
import { isPatchingSource } from '@/lib/security/patching';

type PatchingCopy = Dictionary['security']['patching'];

interface PatchingPanelProps {
  readonly state: PatchingState;
  readonly copy: PatchingCopy;
  /** Whether the reader holds patching:waive; the read key alone must not offer a write. */
  readonly canWaive: boolean;
}

/** Deterministic day label: the same string on the server render and the client hydration. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

function fill(template: string, date: string): string {
  return template.replace('{date}', day(date));
}

function counted(template: string, count: number): string {
  return template.replace('{count}', String(count));
}

const SEVERITY_VARIANT: Record<string, 'red' | 'amber' | 'cyan' | 'neutral'> = {
  CRITICAL: 'red',
  HIGH: 'amber',
  MEDIUM: 'cyan',
  LOW: 'neutral',
  UNKNOWN: 'neutral',
};

/**
 * A waiver row's review state, in the same vocabulary a finding's waiver column renders.
 *
 * WHY derived here and not stored: `expired` is the read path's verdict at request time, and the
 * cell must say exactly what the overview card counted — one value, two renderings.
 */
function waiverCellState(waiver: PatchingWaiver): WaiverState {
  return waiver.expired
    ? { status: 'expired', reviewBy: waiver.reviewBy }
    : { status: 'active', reviewBy: waiver.reviewBy };
}

function WaiverCell({ waiver, copy }: { waiver: WaiverState; copy: PatchingCopy }): React.JSX.Element {
  if (waiver.status === 'none') {
    return <span className="text-xs text-muted-foreground">{copy.waiver.none}</span>;
  }
  if (waiver.status === 'active') {
    return <Badge variant="emerald">{fill(copy.waiver.active, waiver.reviewBy)}</Badge>;
  }
  // Why red and the word "expired": a lapsed decision is not a quiet state. It stays on the
  // row and in its own section below, because hiding it is what an ignore line used to do.
  return <Badge variant="red">{fill(copy.waiver.expired, waiver.reviewBy)}</Badge>;
}

export function PatchingPanel({ state, copy, canWaive }: PatchingPanelProps): React.JSX.Element {
  const [waiveTarget, setWaiveTarget] = useState<{ source: string; match: string } | null>(null);
  const [endTarget, setEndTarget] = useState<PatchingWaiver | null>(null);
  const [match, setMatch] = useState('');
  const [reason, setReason] = useState('');
  const [reviewBy, setReviewBy] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const expired = useMemo(() => state.waivers.filter((waiver) => waiver.expired), [state.waivers]);
  const total = state.groups.reduce((sum, group) => sum + group.findings.length, 0);

  function openWaive(target: { source: string; match: string }): void {
    setWaiveTarget(target);
    setMatch(target.match);
    setReason('');
    setReviewBy('');
    setFeedback(null);
  }

  function submitWaive(): void {
    if (waiveTarget === null) return;
    startTransition(async () => {
      const result = await createPatchingWaiver({
        source: waiveTarget.source,
        match,
        reason,
        reviewBy,
      });
      if (result.success) {
        setWaiveTarget(null);
        setFeedback(copy.saved);
        return;
      }
      setFeedback(result.error ?? copy.failed);
    });
  }

  function submitEnd(): void {
    if (endTarget === null) return;
    startTransition(async () => {
      const result = await endPatchingWaiver(endTarget.id, reason);
      if (result.success) {
        setEndTarget(null);
        setFeedback(copy.ended);
        return;
      }
      setFeedback(result.error ?? copy.failed);
    });
  }

  const findingColumns: ResponsiveColumn<PatchingFinding>[] = [
    {
      key: 'severity',
      header: copy.columns.severity,
      mobileLabel: copy.columns.severity,
      render: (finding) =>
        finding.severity === null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <Badge variant={SEVERITY_VARIANT[finding.severity] ?? 'neutral'}>{finding.severity}</Badge>
        ),
    },
    {
      key: 'subject',
      header: copy.columns.subject,
      mobileLabel: copy.columns.subject,
      render: (finding) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-sm">{finding.subject}</p>
          {finding.title !== null && (
            <p className="truncate text-xs text-muted-foreground">{finding.title}</p>
          )}
        </div>
      ),
    },
    {
      key: 'version',
      header: `${copy.columns.installed} → ${copy.columns.available}`,
      mobileLabel: `${copy.columns.installed} → ${copy.columns.available}`,
      render: (finding) => (
        <span className="font-mono text-xs">
          {finding.installed ?? '—'} → {finding.available ?? '—'}
        </span>
      ),
    },
    {
      key: 'host',
      header: copy.columns.host,
      mobileLabel: copy.columns.host,
      render: (finding) => <span className="font-mono text-xs">{finding.host ?? '—'}</span>,
    },
    {
      key: 'firstSeen',
      header: copy.columns.firstSeen,
      mobileLabel: copy.columns.firstSeen,
      render: (finding) => <span className="font-mono text-xs">{day(finding.firstSeen)}</span>,
    },
    {
      key: 'lastSeen',
      header: copy.columns.lastSeen,
      mobileLabel: copy.columns.lastSeen,
      render: (finding) => <span className="font-mono text-xs">{day(finding.lastSeen)}</span>,
    },
    {
      key: 'waiver',
      header: copy.columns.waiver,
      mobileLabel: copy.columns.waiver,
      render: (finding) => <WaiverCell waiver={finding.waiver} copy={copy} />,
    },
  ];

  /**
   * The waiver list, as the same shared table the findings use.
   *
   * WHY the table component and not a bespoke list: a waiver is a row with columns (what it
   * covers, why, who signed it, when it lapses) exactly like a finding is, and the page already
   * has one responsive table that renders a row as a card on a phone. A second hand-built markup
   * for the same shape would drift from it the first time either changed.
   *
   * WHY the review date is a badge and not a column of plain dates: a lapsed decision has to read
   * as a failure at a glance, and the same red the findings use for a finding whose waiver expired
   * is what tells the operator "this is the one CI is complaining about".
   */
  const waiverColumns: ResponsiveColumn<PatchingWaiver>[] = [
    {
      key: 'source',
      header: copy.columns.source,
      mobileLabel: copy.columns.source,
      render: (waiver) => (
        <span className="font-mono text-xs">
          {isPatchingSource(waiver.source) ? copy.sources[waiver.source] : waiver.source}
        </span>
      ),
    },
    {
      key: 'match',
      header: copy.columns.match,
      mobileLabel: copy.columns.match,
      render: (waiver) => <span className="font-mono text-sm">{waiver.match}</span>,
    },
    {
      key: 'reason',
      header: copy.columns.reason,
      mobileLabel: copy.columns.reason,
      render: (waiver) => (
        <p className="max-w-prose text-xs text-muted-foreground">{waiver.reason}</p>
      ),
    },
    {
      key: 'owner',
      header: copy.columns.owner,
      mobileLabel: copy.columns.owner,
      render: (waiver) => (
        <span className="text-xs">
          {waiver.createdByName ?? `#${String(waiver.createdBy)}`}
        </span>
      ),
    },
    {
      key: 'reviewBy',
      header: copy.columns.reviewBy,
      mobileLabel: copy.columns.reviewBy,
      render: (waiver) => <WaiverCell waiver={waiverCellState(waiver)} copy={copy} />,
    },
  ];

  function renderGroup(group: PatchingGroup): React.JSX.Element {
    return (
      <Card key={group.source}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{copy.sources[group.source]}</h2>
          <span className="font-mono text-sm text-muted-foreground">{group.findings.length}</span>
        </div>
        <ResponsiveTable
          columns={findingColumns}
          rows={[...group.findings]}
          getRowKey={(finding) => finding.id}
          emptyState={<EmptyState title={copy.allClear} />}
          renderRowActions={
            canWaive
              ? (finding) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openWaive({ source: finding.source, match: finding.key })}
                  >
                    {copy.waive}
                  </Button>
                )
              : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ['staleImages', state.cards.staleImages],
            ['unresolvedCves', state.cards.unresolvedCves],
            ['expiredWaivers', state.cards.expiredWaivers],
            ['hostOsUpdates', state.cards.hostOsUpdates],
          ] as const
        ).map(([key, value]) => (
          <Card key={key}>
            <p className="text-sm text-muted-foreground">{copy.cards[key]}</p>
            <p
              className={
                key === 'expiredWaivers' && value > 0
                  ? 'mt-1 font-mono text-2xl text-destructive'
                  : 'mt-1 font-mono text-2xl text-foreground'
              }
            >
              {String(value)}
            </p>
          </Card>
        ))}
      </div>

      {feedback !== null && <p className="text-sm text-muted-foreground">{feedback}</p>}

      {total === 0 ? (
        <Card>
          <EmptyState title={copy.allClear} />
        </Card>
      ) : (
        state.groups.map(renderGroup)
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{copy.waiversTitle}</h2>
          <span className="font-mono text-sm text-muted-foreground">{state.waivers.length}</span>
        </div>
        {expired.length > 0 && (
          <p className="mb-3 text-sm text-destructive">{counted(copy.expiredNotice, expired.length)}</p>
        )}
        <ResponsiveTable
          columns={waiverColumns}
          rows={[...state.waivers]}
          getRowKey={(waiver) => waiver.id}
          // Why no empty-state card inside an empty card: the title and the sentence are one
          // statement ("nothing is waived"), and the shared empty state already reads as one.
          emptyState={<EmptyState title={copy.waiversEmpty} />}
          renderRowActions={
            canWaive
              ? (waiver) => (
                  <Button
                    variant="negativeOutline"
                    size="sm"
                    onClick={() => {
                      setEndTarget(waiver);
                      setReason('');
                      setFeedback(null);
                    }}
                  >
                    {copy.endWaiver}
                  </Button>
                )
              : undefined
          }
        />
      </Card>

      <Dialog
        open={waiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setWaiveTarget(null);
        }}
        title={copy.createTitle}
        description={copy.createDescription}
        pending={pending}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setWaiveTarget(null)} disabled={pending}>
              {copy.cancel}
            </Button>
            <Button
              loading={pending}
              disabled={match.trim() === '' || reason.trim() === '' || reviewBy.trim() === ''}
              onClick={submitWaive}
            >
              {copy.submit}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Input label={copy.matchLabel} value={match} onChange={(event) => setMatch(event.target.value)} required />
          <Input label={copy.reasonLabel} value={reason} onChange={(event) => setReason(event.target.value)} required />
          <Input
            label={copy.reviewByLabel}
            type="date"
            value={reviewBy}
            onChange={(event) => setReviewBy(event.target.value)}
            required
          />
        </div>
      </Dialog>

      <Dialog
        open={endTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEndTarget(null);
        }}
        title={copy.endTitle}
        description={copy.endDescription}
        pending={pending}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEndTarget(null)} disabled={pending}>
              {copy.cancel}
            </Button>
            <Button
              variant="negative"
              loading={pending}
              disabled={reason.trim() === ''}
              onClick={submitEnd}
            >
              {copy.endWaiver}
            </Button>
          </div>
        }
      >
        <Input label={copy.reasonLabel} value={reason} onChange={(event) => setReason(event.target.value)} required />
      </Dialog>
    </div>
  );
}
