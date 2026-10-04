'use client';

import { useRef, useState } from 'react';
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

const CONTROL_CLASS = 'w-full px-3 py-2 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';
const CODE_CLASS = 'w-full px-4 py-2.5 bg-muted/40 border border-border rounded-lg text-foreground font-mono text-sm focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';
const LABEL_CLASS = 'text-xs font-bold text-muted-foreground uppercase mb-1.5 block';
const TOGGLE_ACTIVE = 'px-3 py-1 rounded-lg text-xs font-semibold bg-primary/15 text-primary';
const TOGGLE_IDLE = 'px-3 py-1 rounded-lg text-xs text-muted-foreground hover:bg-muted';
const CODE_PLACEHOLDER = 'e.g. ["alone", ["input.txt", "output.txt"], "diff"]';
const PASTE_NOTICE = 'Pasted content applied without lint. Edit manually to re-lint.';
const INVALID_JSON = 'Task type parameters must be valid JSON.';
const NOT_AN_ARRAY = 'Task type parameters must be a JSON array.';

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
      <select value={value} onChange={(e) => onChange(def, e.target.value)} className={CONTROL_CLASS}>
        {choiceOptions(def, value).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }
  if (def.kind === 'int') {
    return <input type="number" step="1" value={value} onChange={(e) => onChange(def, e.target.value)} className={CONTROL_CLASS} />;
  }
  return <input type="text" value={value} onChange={(e) => onChange(def, e.target.value)} className={CONTROL_CLASS} />;
}

interface FieldListProps {
  taskType: string;
  fields: Fields;
  pastedNotice: boolean;
  onFieldChange: (def: TaskTypeFieldDef, value: string) => void;
}

function FieldList({ taskType, fields, pastedNotice, onFieldChange }: FieldListProps): React.JSX.Element {
  const defs = getTaskTypeFieldDefs(taskType);
  // Why the lint message: an empty definition list means the type is not one
  // the lib knows, and that message is the one the form shows beside it.
  if (defs.length === 0) return <p className="text-xs text-destructive">{lintTaskTypeFields(fields, taskType)}</p>;
  return (
    <>
      {pastedNotice && <p className="text-xs text-info mb-3">{PASTE_NOTICE}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {defs.map((def) => (
          <label key={def.key} className="block">
            <span className={LABEL_CLASS}>{def.label}</span>
            <FieldControl def={def} value={fields[def.key] ?? ''} onChange={onFieldChange} />
          </label>
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
    <textarea
      value={codeText}
      onChange={(e) => onCodeChange(e.target.value)}
      rows={5}
      spellCheck={false}
      className={CODE_CLASS}
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
  return (
    <div className="flex items-center gap-1 mb-3">
      <button type="button" onClick={onVisual} className={view === 'visual' ? TOGGLE_ACTIVE : TOGGLE_IDLE}>Visual</button>
      <button type="button" onClick={onCode} className={view === 'code' ? TOGGLE_ACTIVE : TOGGLE_IDLE}>JSON</button>
    </div>
  );
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

  // Why adjust during render instead of an effect: changing task type or
  // picking another dataset replaces the params behind the editor, and stale
  // fields would write the previous type's values back. A list pushed from the
  // code view skips the rewrite so typing is not reformatted on every keystroke.
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
