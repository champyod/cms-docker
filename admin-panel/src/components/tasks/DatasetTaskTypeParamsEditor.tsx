'use client';

import { useRef, useState } from 'react';

import { Input } from '@/components/core/Input';
import { Select } from '@/components/core/Select';
import { Tabs, type TabItem } from '@/components/core/Tabs';
import { Textarea } from '@/components/core/Textarea';
import {
  TASK_TYPE_PARAM_HELPERS,
  defaultTaskTypeFields,
  defaultTaskTypeParams,
  fieldsToTaskTypeParams,
  getTaskTypeFieldDefs,
  lintTaskTypeFields,
  taskTypeParamsToFields,
  type TaskTypeFieldDef,
} from './dataset-tasktype-params';

type Fields = Record<string, string>;
type View = 'visual' | 'code';
type EmitTarget = Pick<EditorProps, 'onParamsChange' | 'onLintError'>;

interface EditorProps {
  taskType: string;
  params: unknown;
  onParamsChange: (params: unknown) => void;
  onLintError: (error: string) => void;
}

const CODE_PLACEHOLDER = 'e.g. ["alone", ["input.txt", "output.txt"], "diff"]';
const PASTE_NOTICE = 'Pasted content applied without lint. Edit manually to re-lint.';
const INVALID_JSON = 'Task type parameters must be valid JSON.';
const NOT_AN_ARRAY = 'Task type parameters must be a JSON array.';

const VIEW_TABS: readonly TabItem[] = [
  { id: 'visual', label: 'Visual' },
  { id: 'code', label: 'JSON' },
];

/** The JSON view shows the list the worker will read, so an empty stored list
 *  is shown as this type's defaults rather than as `[]`. */
function codeTextFor(params: unknown, taskType: string): string {
  const stored = Array.isArray(params) && params.length > 0 ? params : defaultTaskTypeParams(taskType);
  return JSON.stringify(stored ?? [], null, 2);
}

/** A stored choice outside the options stays in the list, so the reader sees
 *  what the dataset holds instead of an empty control. */
function choiceOptions(def: TaskTypeFieldDef, current: string): readonly string[] {
  if (current === '' || def.options.includes(current)) return def.options;
  return [current, ...def.options];
}

function signatureOf(taskType: string, params: unknown): string {
  return `${taskType}:${JSON.stringify(params) ?? ''}`;
}

/** Empty text is this type's defaults, so an emptied view is never a stored
 *  empty list the worker would reject. */
function parseCodeParams(value: string, taskType: string): Fields | string {
  if (value.trim() === '') return defaultTaskTypeFields(taskType);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return INVALID_JSON;
  }
  if (!Array.isArray(parsed)) return NOT_AN_ARRAY;
  return taskTypeParamsToFields(parsed, taskType);
}

/** Why the verdict first: the form forwards one list and one verdict per
 *  callback, so the verdict has to land before the list it was read from. */
function emitFields(taskType: string, next: Fields, lint: string, target: EmitTarget): void {
  target.onLintError(lint);
  const built = fieldsToTaskTypeParams(next, taskType);
  if (built !== null) target.onParamsChange(built);
}

interface FieldControlProps {
  def: TaskTypeFieldDef;
  value: string;
  onChange: (def: TaskTypeFieldDef, value: string) => void;
}

function FieldControl({ def, value, onChange }: FieldControlProps): React.JSX.Element {
  if (def.kind === 'choice') {
    return (
      <Select
        label={def.label}
        value={value}
        onChange={(event) => onChange(def, event.target.value)}
        options={choiceOptions(def, value).map((option) => ({ value: option, label: option }))}
      />
    );
  }
  if (def.kind === 'int') {
    return (
      <Input
        label={def.label}
        type="number"
        step={1}
        value={value}
        onChange={(event) => onChange(def, event.target.value)}
      />
    );
  }
  return <Input label={def.label} type="text" value={value} onChange={(event) => onChange(def, event.target.value)} />;
}

interface FieldListProps {
  taskType: string;
  fields: Fields;
  pastedNotice: boolean;
  onFieldChange: (def: TaskTypeFieldDef, value: string) => void;
}

function FieldList({ taskType, fields, pastedNotice, onFieldChange }: FieldListProps): React.JSX.Element {
  const defs = getTaskTypeFieldDefs(taskType);
  // Why the lint message: an empty definition list means the lib does not know the type, and that is the message the form shows beside it.
  if (defs.length === 0) return <p className="text-xs text-destructive">{lintTaskTypeFields(fields, taskType)}</p>;
  return (
    <>
      {pastedNotice && <p className="text-xs text-muted-foreground mb-3">{PASTE_NOTICE}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {defs.map((def) => (
          <FieldControl key={def.key} def={def} value={fields[def.key] ?? ''} onChange={onFieldChange} />
        ))}
      </div>
    </>
  );
}

interface JsonBoxProps {
  codeText: string;
  onCodeChange: (value: string) => void;
}

function JsonBox({ codeText, onCodeChange }: JsonBoxProps): React.JSX.Element {
  return (
    <Textarea
      value={codeText}
      onChange={(event) => onCodeChange(event.target.value)}
      rows={5}
      spellCheck={false}
      className="font-mono"
      placeholder={CODE_PLACEHOLDER}
    />
  );
}

interface ViewToggleProps {
  view: View;
  onVisual: () => void;
  onCode: () => void;
}

function ViewToggle({ view, onVisual, onCode }: ViewToggleProps): React.JSX.Element {
  const select = (id: string): void => {
    if (id === 'code') onCode();
    else onVisual();
  };
  return <Tabs items={VIEW_TABS} activeId={view} ariaLabel="Parameter view" className="mb-3" onSelect={select} />;
}

interface VisualParams {
  fields: Fields;
  setFields: (fields: Fields) => void;
  onFieldChange: (def: TaskTypeFieldDef, value: string) => void;
  markPaste: () => void;
  clearPasteNotice: () => void;
  pastedNotice: boolean;
}

interface CodeParams {
  codeText: string;
  setCodeText: (text: string) => void;
  isPushed: boolean;
  onCodeChange: (value: string) => void;
}

function useVisualParams(taskType: string, params: unknown, target: EmitTarget): VisualParams {
  const pastedRef = useRef(false);
  const [pastedNotice, setPastedNotice] = useState(false);
  const [fields, setFields] = useState<Fields>(() => taskTypeParamsToFields(params, taskType));

  const onFieldChange = (def: TaskTypeFieldDef, value: string): void => {
    const isPasted = pastedRef.current;
    pastedRef.current = false;
    setPastedNotice(isPasted);
    const next = { ...fields, [def.key]: value };
    emitFields(taskType, next, isPasted ? '' : lintTaskTypeFields(next, taskType), target);
  };
  const markPaste = (): void => { pastedRef.current = true; };
  const clearPasteNotice = (): void => {
    pastedRef.current = false;
    setPastedNotice(false);
  };
  return { fields, setFields, onFieldChange, markPaste, clearPasteNotice, pastedNotice };
}

function useCodeParams(taskType: string, target: EmitTarget, clearPasteNotice: () => void): CodeParams {
  const [codeText, setCodeText] = useState('');
  const [isPushed, setIsPushed] = useState(false);

  const onCodeChange = (value: string): void => {
    clearPasteNotice();
    setCodeText(value);
    const parsed = parseCodeParams(value, taskType);
    if (typeof parsed === 'string') {
      setIsPushed(false);
      target.onLintError(parsed);
      return;
    }
    setIsPushed(true);
    emitFields(taskType, parsed, lintTaskTypeFields(parsed, taskType), target);
  };
  return { codeText, setCodeText, isPushed, onCodeChange };
}

export function DatasetTaskTypeParamsEditor({ taskType, params, onParamsChange, onLintError }: EditorProps): React.JSX.Element {
  const target: EmitTarget = { onParamsChange, onLintError };
  const { fields, setFields, onFieldChange, markPaste, clearPasteNotice, pastedNotice } = useVisualParams(taskType, params, target);
  const { codeText, setCodeText, isPushed, onCodeChange } = useCodeParams(taskType, target, clearPasteNotice);
  const [view, setView] = useState<View>('visual');

  // Why during render: a new task type or dataset replaces params behind the editor, so stale fields would write the old type back; a code-view push skips the rewrite.
  const signature = signatureOf(taskType, params);
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setFields(taskTypeParamsToFields(params, taskType));
    if (!isPushed) setCodeText(codeTextFor(params, taskType));
  }

  return (
    <div onPasteCapture={markPaste}>
      <ViewToggle
        view={view}
        onVisual={() => setView('visual')}
        onCode={() => { setCodeText(codeTextFor(params, taskType)); setView('code'); }}
      />
      <p className="text-xs text-muted-foreground mb-3">{TASK_TYPE_PARAM_HELPERS[taskType] ?? 'Configure the task type parameters.'}</p>
      {view === 'code' ? (
        <JsonBox codeText={codeText} onCodeChange={onCodeChange} />
      ) : (
        <FieldList taskType={taskType} fields={fields} pastedNotice={pastedNotice} onFieldChange={onFieldChange} />
      )}
    </div>
  );
}
