import { DefinitionEntry } from '@/components/core/DefinitionEntry';
import type { TaskSettingsData } from '@/lib/queries/task-detail';
import type { Dictionary } from '@/lib/dictionary';
import { humanizeEnum } from '@/lib/format-text';

export type TaskSettingsTabProps = {
  data: TaskSettingsData;
  labels: Dictionary['tasks']['facts'];
  notSet: string;
};

/** The record shell above already opens this dialog; the group shows the values instead. */
export function TaskSettingsTab({ data, labels, notSet }: TaskSettingsTabProps): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <DefinitionEntry term={labels.scoreMode} value={humanizeEnum(data.task.score_mode)} />
      <DefinitionEntry term={labels.feedback} value={humanizeEnum(data.task.feedback_level)} />
      {/* Why a word and not a dash: a null precision is a task that never set one, not a 0, and
          DESIGN.md 19 bans the em dash from anything a reader sees. */}
      <DefinitionEntry term={labels.scorePrecision} value={data.task.score_precision === null ? notSet : String(data.task.score_precision)} />
      <DefinitionEntry term={labels.tokenMode} value={humanizeEnum(data.task.token_mode)} />
    </dl>
  );
}
