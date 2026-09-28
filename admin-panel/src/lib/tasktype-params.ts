import {
  defaultTaskTypeParams,
  getTaskTypeFieldDefs,
  type TaskTypeFieldDef,
} from '@/components/tasks/dataset-tasktype-params';

export const DEFAULT_TASK_TYPE = 'Batch';

export type TaskTypeParamsResult =
  | { isValid: true; params: unknown[] }
  | { isValid: false; message: string };

/** Splits the field definitions into the top-level parameters the task type
 *  declares, so a collection such as the Batch I/O pair counts once. */
function groupByParameter(defs: readonly TaskTypeFieldDef[]): TaskTypeFieldDef[][] {
  const groups = new Map<number, TaskTypeFieldDef[]>();
  for (const def of defs) {
    const group = groups.get(def.path[0]);
    if (group) group.push(def);
    else groups.set(def.path[0], [def]);
  }
  return [...groups.values()];
}

function valueMessage(def: TaskTypeFieldDef, value: unknown): string | null {
  if (def.kind === 'choice') {
    return typeof value === 'string' && def.options.includes(value)
      ? null
      : `${def.label} must be one of: ${def.options.join(', ')}.`;
  }
  if (def.kind === 'int') {
    return Number.isInteger(value) ? null : `${def.label} must be an integer.`;
  }
  return typeof value === 'string' ? null : `${def.label} must be a string.`;
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function parameterMessage(value: unknown, defs: readonly TaskTypeFieldDef[]): string | null {
  const [first] = defs;
  if (defs.length === 1 && first.path.length === 1) return valueMessage(first, value);
  if (!Array.isArray(value) || value.length !== defs.length) {
    return `${first.label} must be a list of ${countLabel(defs.length, 'value')}.`;
  }
  for (const [position, def] of defs.entries()) {
    const message = valueMessage(def, value[position]);
    if (message !== null) return message;
  }
  return null;
}

/** Whether the list says nothing at all, which is an untouched form rather
 *  than a parameter list the worker could read. */
export function isEmptyTaskTypeParams(params: unknown): boolean {
  return params === undefined || params === null || (Array.isArray(params) && params.length === 0);
}

/** Validates `task_type_parameters` against the rules the worker applies in
 *  `TaskType.validate_parameters`: one entry per declared parameter, matching
 *  element types, and choices drawn from the task type's own option list. An
 *  empty list is not a violation but an untouched form, so it becomes the
 *  defaults the worker would read; an unknown task type fails closed. */
export function validateTaskTypeParams(taskType: string, params: unknown): TaskTypeParamsResult {
  const groups = groupByParameter(getTaskTypeFieldDefs(taskType));
  const defaults = defaultTaskTypeParams(taskType);
  if (groups.length === 0 || defaults === null) {
    return { isValid: false, message: `Unknown task type "${taskType}".` };
  }
  if (isEmptyTaskTypeParams(params)) return { isValid: true, params: defaults };
  if (!Array.isArray(params)) {
    return { isValid: false, message: 'Task type parameters must be an array.' };
  }
  if (params.length !== groups.length) {
    const shape = JSON.stringify(defaults);
    const expected = countLabel(groups.length, 'parameter');
    return {
      isValid: false,
      message: `Task type "${taskType}" expects ${expected}, received ${params.length}. Expected shape: ${shape}.`,
    };
  }
  for (const [position, group] of groups.entries()) {
    const message = parameterMessage(params[position], group);
    if (message !== null) return { isValid: false, message };
  }
  return { isValid: true, params };
}
