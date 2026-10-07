import { cn } from '@/lib/utils';

export interface FormFieldRenderProps {
  readonly id: string;
  readonly 'aria-invalid'?: true;
  readonly 'aria-describedby'?: string;
}

export interface FormFieldProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly children: (props: FormFieldRenderProps) => React.ReactNode;
}

// Why the control is a render prop rather than a wrapped element: a select, a
// textarea, and a composed control each need the same association triple, and
// wrapping any one of them would force the other two through it.
function describedBy(id: string, hint: string | undefined, error: string | undefined): string | undefined {
  const ids = [hint === undefined ? null : `${id}-hint`, error === undefined ? null : `${id}-error`].filter(
    (entry): entry is string => entry !== null,
  );
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function controlProps(id: string, hint: string | undefined, error: string | undefined): FormFieldRenderProps {
  const description = describedBy(id, hint, error);
  if (error !== undefined) return { id, 'aria-invalid': true, 'aria-describedby': description };
  return description === undefined ? { id } : { id, 'aria-describedby': description };
}

export function FormField({ id, label, hint, error, required, children }: FormFieldProps): React.JSX.Element {
  return (
    <div className="w-full space-y-1.5">
      {label.length > 0 && (
        <label htmlFor={id} className="ml-1 text-sm font-medium text-foreground">
          {label}
          {required === true && (
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
          )}
        </label>
      )}
      {children(controlProps(id, hint, error))}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="ml-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} role="alert" className="ml-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const FIELD_CLASSES =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20';

export interface SelectFieldProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  readonly id: string;
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string;
}

export function SelectField({ id, label, hint, error, className, ...props }: SelectFieldProps): React.JSX.Element {
  return (
    <FormField id={id} label={label ?? ''} hint={hint} error={error}>
      {(render) => <select {...render} {...props} className={cn(FIELD_CLASSES, className)} />}
    </FormField>
  );
}

export interface TextareaFieldProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  readonly id: string;
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string;
}

export function TextareaField({
  id,
  label,
  hint,
  error,
  className,
  ...props
}: TextareaFieldProps): React.JSX.Element {
  return (
    <FormField id={id} label={label ?? ''} hint={hint} error={error}>
      {(render) => <textarea {...render} {...props} className={cn(FIELD_CLASSES, className)} />}
    </FormField>
  );
}
