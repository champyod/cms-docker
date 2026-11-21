'use client';

import { useState } from 'react';
import { Ban, Play } from 'lucide-react';

import { endTarget, showTarget } from '@/app/actions/rankingConfig';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { FormField, SelectField } from '@/components/core/FormField';
import { Input } from '@/components/core/Input';
import { Stack } from '@/components/core/Layout';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { Text } from '@/components/core/Typography';
import { AttributionMark } from '@/components/ranking/AttributionMark';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';
import type { Dictionary } from '@/lib/dictionary';
import { SHOWN_KIND, type ShownTarget, type ShownTargetChoice } from '@/lib/ranking-config';

type ShownCopy = Dictionary['ranking']['shown'];

export interface RankingConfigSurfaceProps {
  readonly copy: ShownCopy;
  readonly rows: readonly ShownTarget[];
  readonly choices: readonly ShownTargetChoice[];
  /** False for a reader who may look at the board but not change what it shows. */
  readonly canShow: boolean;
}

/**
 * The board's config: the contests the ranking draws.
 *
 * WHY it sits beside the override surface and is not part of it: the config says what the board
 * shows and an override is the exception that wins over it, so they are two surfaces with two
 * jobs. Presenting them as one list — which is what the retired wording did — is what left an
 * operator unable to say which of the two they were looking at.
 */
export function RankingConfigSurface({
  copy,
  rows,
  choices,
  canShow,
}: RankingConfigSurfaceProps): React.JSX.Element {
  const router = useAppRouter();
  const reasonPrompt = useReasonPrompt();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!canShow) {
    return (
      <Card className="space-y-3">
        <Text as="h2" variant="h3">
          {copy.title}
        </Text>
        <ShownList copy={copy} rows={rows} onEnd={null} />
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <Text as="h2" variant="h3">
        {copy.title}
      </Text>
      <Text variant="muted">{copy.hint}</Text>
      <form
        action={async (formData: FormData) => {
          setFailure(null);
          setPending(true);
          try {
            await showTarget(formData);
            router.refresh();
          } catch (error) {
            setFailure(error instanceof Error ? error.message : copy.showFailed);
          } finally {
            setPending(false);
          }
        }}
        className="space-y-4"
      >
        <Stack direction="row" gap={3} wrap align="end">
          <FormField id="ranking-shown-contest" label={copy.contestField} hint={copy.contestHint} required>
            {({ id }) => (
              <SelectField id={id} name="targetKey" required defaultValue="">
                <option value="" disabled>
                  {copy.contestPlaceholder}
                </option>
                {choices.map((choice) => (
                  <option key={choice.id} value={String(choice.id)}>
                    {choice.name}
                  </option>
                ))}
              </SelectField>
            )}
          </FormField>
          <Input id="ranking-shown-reason" name="reason" label={copy.reasonField} required />
          <input type="hidden" name="kind" value={SHOWN_KIND} />
          <Button type="submit" variant="positive" icon={Play} loading={pending}>
            {copy.show}
          </Button>
        </Stack>
      </form>
      {failure !== null ? (
        <Text variant="muted" role="alert">
          {failure}
        </Text>
      ) : null}
      <ShownList
        copy={copy}
        rows={rows}
        onEnd={(row) =>
          reasonPrompt.ask({
            title: copy.endTitle,
            description: row.key,
            submitLabel: copy.end,
            run: async (reason) => {
              try {
                await endTarget(row.id, reason);
                router.refresh();
                return { success: true, message: copy.ended };
              } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : copy.endFailed };
              }
            },
          })
        }
      />
      <ReasonDialog
        request={reasonPrompt.request}
        onClose={reasonPrompt.close}
        onSubmit={reasonPrompt.submit}
      />
    </Card>
  );
}

interface ShownListProps {
  readonly copy: ShownCopy;
  readonly rows: readonly ShownTarget[];
  readonly onEnd: ((row: ShownTarget) => void) | null;
}

/** The live set, with a reasoned end on each row for an operator who may change it. */
function ShownList({ copy, rows, onEnd }: ShownListProps): React.JSX.Element {
  if (rows.length === 0) {
    return <EmptyState title={copy.empty} description={copy.emptyHint} />;
  }
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-3">
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.key}</span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">
                {row.kind} · {row.reason}
              </span>
              {/*
                WHY the author is on every row: a config row can be written outside the panel
                (`created_by` NULL), and a list that printed nothing there would read exactly like
                one whose author it simply did not show. The mark comes from the same predicate and
                the same shape the override list uses, so the two surfaces cannot disagree about
                which rows the panel wrote.
              */}
              <AttributionMark row={row} unattributedLabel={copy.outsidePanelBadge} />
            </span>
          </span>
          {onEnd !== null ? (
            <Button variant="negative" size="sm" icon={Ban} onClick={() => onEnd(row)}>
              {copy.end}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
