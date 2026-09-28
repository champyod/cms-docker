export type TaskTypeFieldKind = 'choice' | 'int' | 'text';

/** Field definitions mirror the ACCEPTED_PARAMETERS of the CMS task types
 *  (`src/cms/grading/tasktypes/*.py`): `path` indexes into the parameter
 *  array, so a Python collection parameter maps to one field per element. */
export interface TaskTypeFieldDef {
  key: string;
  label: string;
  kind: TaskTypeFieldKind;
  path: readonly number[];
  defaultValue: string;
  options: readonly string[];
}

export const TASK_TYPE_PARAM_HELPERS: Record<string, string> = {
  Batch: 'Compilation, I/O file names (leave both blank to use stdin/stdout) and output evaluation.',
  OutputOnly: 'Output evaluation: white diff or a comparator.',
  TwoSteps: 'Output evaluation: white diff or a comparator.',
  Communication: 'Number of user processes, compilation, and how user processes talk to the manager.',
};

function outputEvaluationField(path: readonly number[]): TaskTypeFieldDef {
  return {
    key: 'output_eval',
    label: 'Output evaluation',
    kind: 'choice',
    path,
    defaultValue: 'diff',
    options: ['diff', 'comparator'],
  };
}

export const TASK_TYPE_FIELD_DEFS: Record<string, readonly TaskTypeFieldDef[]> = {
  Batch: [
    { key: 'compilation', label: 'Compilation', kind: 'choice', path: [0], defaultValue: 'alone', options: ['alone', 'grader'] },
    { key: 'inputfile', label: 'Input file', kind: 'text', path: [1, 0], defaultValue: '', options: [] },
    { key: 'outputfile', label: 'Output file', kind: 'text', path: [1, 1], defaultValue: '', options: [] },
    outputEvaluationField([2]),
  ],
  OutputOnly: [outputEvaluationField([0])],
  TwoSteps: [outputEvaluationField([0])],
  Communication: [
    { key: 'num_processes', label: 'Number of processes', kind: 'int', path: [0], defaultValue: '1', options: [] },
    { key: 'compilation', label: 'Compilation', kind: 'choice', path: [1], defaultValue: 'alone', options: ['alone', 'stub'] },
    { key: 'user_io', label: 'User I/O', kind: 'choice', path: [2], defaultValue: 'std_io', options: ['std_io', 'fifo_io'] },
  ],
};

type FieldParse =
  | { isValid: true; value: unknown }
  | { isValid: false; message: string };

/** Accepts only what Python's `int()` parses, so the worker can read back
 *  every value the panel stores (1e3 and 1.5 are not integers there). */
const INTEGER_PATTERN = /^[+-]?\d+$/;

export function getTaskTypeFieldDefs(taskType: string): readonly TaskTypeFieldDef[] {
  const defs = TASK_TYPE_FIELD_DEFS[taskType];
  return defs === undefined ? [] : defs;
}

function parseFieldValue(def: TaskTypeFieldDef, raw: string): FieldParse {
  const text = raw.trim();
  if (def.kind === 'int') {
    if (!INTEGER_PATTERN.test(text)) {
      return { isValid: false, message: `${def.label} must be an integer.` };
    }
    return { isValid: true, value: Number(text) };
  }
  if (def.kind === 'choice') {
    if (text === '') return { isValid: false, message: `${def.label} is required.` };
    if (!def.options.includes(text)) {
      return { isValid: false, message: `${def.label} must be one of: ${def.options.join(', ')}.` };
    }
    return { isValid: true, value: text };
  }
  return { isValid: true, value: text };
}

function readParamSlot(params: unknown, path: readonly number[]): unknown {
  let current: unknown = params;
  for (const index of path) {
    if (!Array.isArray(current)) return undefined;
    const list: unknown[] = current;
    current = list[index];
  }
  return current;
}

function writeParamSlot(root: unknown[], path: readonly number[], value: unknown): void {
  let cursor: unknown[] = root;
  for (let depth = 0; depth < path.length - 1; depth += 1) {
    const existing = cursor[path[depth]];
    if (!Array.isArray(existing)) {
      const created: unknown[] = [];
      cursor[path[depth]] = created;
      cursor = created;
      continue;
    }
    const list: unknown[] = existing;
    cursor = list;
  }
  cursor[path[path.length - 1]] = value;
}

function toFieldText(value: unknown, def: TaskTypeFieldDef): string {
  if (typeof value === 'string') return value;
  if (def.kind === 'int' && typeof value === 'number') return String(value);
  return def.defaultValue;
}

export function defaultTaskTypeFields(taskType: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const def of getTaskTypeFieldDefs(taskType)) fields[def.key] = def.defaultValue;
  return fields;
}

export function taskTypeParamsToFields(params: unknown, taskType: string): Record<string, string> {
  const defs = getTaskTypeFieldDefs(taskType);
  if (!Array.isArray(params) || params.length === 0) return defaultTaskTypeFields(taskType);
  const fields: Record<string, string> = {};
  for (const def of defs) fields[def.key] = toFieldText(readParamSlot(params, def.path), def);
  return fields;
}

/** Returns null when the task type is unknown or a field cannot be
 *  serialized, so the caller keeps the parameters it already has. */
export function fieldsToTaskTypeParams(fields: Record<string, string>, taskType: string): unknown[] | null {
  const defs = getTaskTypeFieldDefs(taskType);
  if (defs.length === 0) return null;
  const params: unknown[] = [];
  for (const def of defs) {
    const raw = fields[def.key];
    if (typeof raw !== 'string') return null;
    const parsed = parseFieldValue(def, raw);
    if (!parsed.isValid) return null;
    writeParamSlot(params, def.path, parsed.value);
  }
  return params;
}

export function defaultTaskTypeParams(taskType: string): unknown[] | null {
  return fieldsToTaskTypeParams(defaultTaskTypeFields(taskType), taskType);
}

export function lintTaskTypeFields(fields: Record<string, string>, taskType: string): string {
  const defs = getTaskTypeFieldDefs(taskType);
  if (defs.length === 0) return `Unknown task type "${taskType}".`;
  const missing = defs.filter((def) => typeof fields[def.key] !== 'string');
  if (missing.length > 0) {
    const keys = missing.map((def) => def.key).join(', ');
    return `Task type "${taskType}" expects ${defs.length} parameters; missing ${keys}.`;
  }
  for (const def of defs) {
    const parsed = parseFieldValue(def, fields[def.key]);
    if (!parsed.isValid) return parsed.message;
  }
  return '';
}
