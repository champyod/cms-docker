'use client';

import { Button } from '@/components/core/Button';
import { RestrictedField } from '@/components/core/RestrictedField';
import { cn } from '@/lib/utils';
import type { FieldAccess } from '@/lib/field-permissions';
import { isKnownLanguageCode, normalizeLanguageCode } from '@/lib/constants/languages';

interface UserPreferredLanguagesFieldProps {
  access: FieldAccess;
  languages: string[];
  draft: string;
  inputClassName: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (code: string) => void;
}

export function UserPreferredLanguagesField({
  access,
  languages,
  draft,
  inputClassName,
  onDraftChange,
  onAdd,
  onRemove,
}: UserPreferredLanguagesFieldProps): React.JSX.Element {
  return (
    <RestrictedField
      canRead={access.canRead}
      canUpdate={access.canUpdate}
      label="Preferred Languages"
      lockHint="Read-only — you lack user:update"
    >
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {languages.length === 0 ? (
            <span className="text-xs text-muted-foreground">No languages selected.</span>
          ) : (
            languages.map((code) => {
              const known = isKnownLanguageCode(code);
              return (
                <span key={code} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs', known ? 'border-border bg-muted' : 'border-amber-500/40 bg-amber-500/10 text-amber-700')}>
                  <span className="font-mono">{code}</span>
                  {!known ? <span className="text-[0.625rem]">unknown</span> : null}
                  {access.canUpdate ? (
                    <button type="button" onClick={() => onRemove(code)} className="ml-1 text-muted-foreground hover:text-foreground">×</button>
                  ) : null}
                </span>
              );
            })
          )}
        </div>
        {access.canUpdate ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onAdd();
                }
              }}
              placeholder="en, th, fr…"
              className={cn(inputClassName, 'font-mono')}
            />
            <Button type="button" variant="secondary" onClick={onAdd} disabled={!normalizeLanguageCode(draft)}>
              Add
            </Button>
          </div>
        ) : null}
        {(() => {
          const pending = normalizeLanguageCode(draft);
          if (!pending || isKnownLanguageCode(pending)) return null;
          return <p className="text-xs text-amber-600">Unrecognised code — will be saved as “{pending}” but may not match any statement. Use a code from the shared languages list (languages.json).</p>;
        })()}
        <p className="text-xs text-muted-foreground">Stored normalized (trim + lowercase). Exact match against statement.language.</p>
      </div>
    </RestrictedField>
  );
}
