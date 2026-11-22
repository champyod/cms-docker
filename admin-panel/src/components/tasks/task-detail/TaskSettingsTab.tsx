import { DefinitionEntry } from '@/components/core/DefinitionEntry';
import type { TaskSettingsData } from '@/lib/queries/task-detail';
import { humanizeEnum } from '@/lib/format-text';

export type TaskSettingsTabProps = { data: TaskSettingsData };

/**
 * The value each setting the group lists holds right now.
 *
 * Why the values and not an edit button: the record shell above already offers "Edit Task", which
 * opens exactly the dialog this tab used to open, so the second identical button was one action drawn
 * twice. The group says what each value means; the write goes through the record's one action.
 */
export function TaskSettingsTab({ data }: TaskSettingsTabProps): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <DefinitionEntry term="Score mode" value={humanizeEnum(data.task.score_mode)} />
      <DefinitionEntry term="Feedback" value={humanizeEnum(data.task.feedback_level)} />
      {/* Why the missing mark: a null precision is a task that never set one, not a 0. */}
      <DefinitionEntry term="Score precision" value={data.task.score_precision === null ? '—' : String(data.task.score_precision)} />
      <DefinitionEntry term="Token mode" value={humanizeEnum(data.task.token_mode)} />
    </dl>
  );
}
