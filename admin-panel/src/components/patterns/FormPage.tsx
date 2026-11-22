import type { ReactNode } from 'react';

import { InlineAlert } from '@/components/core/InlineAlert';
import { PageSurface } from '@/components/core/PageSurface';
import type { PageSlots } from '@/components/patterns/page-types';

export interface FormPageProps extends PageSlots {
  /** The fields, in the order they are filled. */
  readonly children: ReactNode;
  /** Errors from the last submit; rendered above the fields, not only beside each one. */
  readonly errors?: readonly string[];
  /** The submit control and its neighbours: exactly one primary. */
  readonly submit: ReactNode;
  readonly secondary?: ReactNode;
  /** What happens on success, in one line, so the button is not a guess. */
  readonly consequence?: ReactNode;
  /** False when a module shell above already renders the page header. */
  readonly ownsHeader?: boolean;
}

/**
 * The form layout: what to supply, what is wrong with it, and what pressing the button does.
 *
 * The error summary sits above the fields because a field error below the fold is invisible at the
 * moment the reader is deciding whether the form worked. It is announced assertively: the reader
 * just pressed submit, so this is the one place interrupting is correct.
 */
export function FormPage({
  breadcrumbs,
  title,
  description,
  actions,
  children,
  errors,
  submit,
  secondary,
  consequence,
  ownsHeader = true,
}: FormPageProps): React.JSX.Element {
  const hasErrors = errors !== undefined && errors.length > 0;
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions} ownsHeader={ownsHeader}>
      <div className="max-w-2xl space-y-4">
        {hasErrors && (
          <InlineAlert tone="destructive" title="This form needs a correction" announce="assertive">
            <ul className="list-disc space-y-1 pl-4">
              {errors?.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </InlineAlert>
        )}
        <div className="space-y-4">{children}</div>
        <div className="flex items-center gap-2">
          {submit}
          {secondary}
        </div>
        {consequence && <p className="text-muted-foreground">{consequence}</p>}
      </div>
    </PageSurface>
  );
}
