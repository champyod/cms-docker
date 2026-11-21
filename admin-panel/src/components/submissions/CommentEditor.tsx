'use client';

import { useId } from 'react';

import { Button } from '@/components/core/Button';
import { useDictionary } from '@/hooks/useDictionary';
import { appendCommentSnippet, MAX_SUBMISSION_COMMENT_LENGTH } from '@/lib/submission-comment';

const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

export interface CommentEditorProps {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}

export function CommentEditor({ value, disabled = false, onChange }: CommentEditorProps): React.JSX.Element {
  const copy = useDictionary().submissions.record.comment;
  const fieldId = useId();
  return (
    <div className="space-y-2">
      {copy.snippets.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{copy.snippetsLabel}</p>
          <div className="flex flex-wrap gap-1">
            {copy.snippets.map((snippet) => (
              <Button
                key={snippet}
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                className="h-auto whitespace-normal py-1 text-left text-xs"
                onClick={() => onChange(appendCommentSnippet(value, snippet))}
              >
                {snippet}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <label htmlFor={fieldId} className="text-sm font-medium text-foreground ml-1">{copy.label}</label>
      <textarea
        id={fieldId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        maxLength={MAX_SUBMISSION_COMMENT_LENGTH}
        disabled={disabled}
        className={FIELD_CLASSES}
      />
      <p aria-hidden="true" className="text-right text-xs text-muted-foreground">
        {value.length + ' / ' + MAX_SUBMISSION_COMMENT_LENGTH}
      </p>
    </div>
  );
}
