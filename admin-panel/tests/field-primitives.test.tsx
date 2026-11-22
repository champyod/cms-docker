import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Checkbox } from '@/components/core/Checkbox';
import { Input } from '@/components/core/Input';
import { Select } from '@/components/core/Select';
import { Textarea } from '@/components/core/Textarea';

/**
 * These assert the associations, not the appearance: a field whose label cannot focus it and
 * whose error is never announced looks correct and is unusable, and the markup is the only place
 * the difference shows.
 */
describe('field primitives', () => {
  it('binds Input label and error to the field', () => {
    const html = renderToStaticMarkup(<Input label="Contest name" error="Required" />);
    const id = /id="([^"]+)"/.exec(html)?.[1] ?? '';

    expect(id).not.toBe('');
    expect(html).toContain(`<label for="${id}"`);
    expect(html).toContain(`aria-describedby="${id}-error"`);
    expect(html).toContain(`id="${id}-error"`);
    expect(html).toContain('aria-invalid="true"');
  });

  it('renders a native select with a placeholder that cannot be submitted', () => {
    const html = renderToStaticMarkup(
      <Select
        label="Shard"
        placeholder="Choose a shard"
        options={[
          { value: 'a', label: 'shard-a' },
          { value: 'b', label: 'shard-b', disabled: true },
        ]}
      />
    );

    expect(html).toContain('<select');
    expect(html).toContain('<option value="" disabled');
    expect(html).toContain('shard-b');
    expect(html).toContain('disabled');
    // the chevron is decoration and must never be announced
    expect(html).toContain('aria-hidden="true"');
  });

  it('gives Checkbox a 24px target through the label row, not the box', () => {
    const html = renderToStaticMarkup(
      <Checkbox label="Notify the operator" description="Sends one message per incident" />
    );

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('min-h-6');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('size-4');
  });

  it('links Textarea hint and error separately', () => {
    const html = renderToStaticMarkup(<Textarea label="Reason" hint="Shown in the audit log" error="Too short" />);
    const id = /id="([^"]+)"/.exec(html)?.[1] ?? '';

    expect(html).toContain(`aria-describedby="${id}-hint ${id}-error"`);
    expect(html).toContain('resize-y');
  });
});
