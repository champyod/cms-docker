// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CredentialTemplateField } from '@/components/core/CredentialTemplateField';
import { GeneratorConfigDialog } from '@/components/core/GeneratorConfigDialog';
import { USERNAME_CONFIG, type GeneratorConfig } from '@/lib/credential-template';

afterEach(() => cleanup());

const SPECIAL_LABEL = 'Special symbols (@ # $ % ...)';
const OPERATOR_LABEL = 'Operator symbols (- + = _ [ ] ?)';

function buttonNamed(name: string): HTMLButtonElement {
  const button = screen.getByRole('button', { name });
  if (!(button instanceof HTMLButtonElement)) throw new Error(`no button named ${name}`);
  return button;
}

function renderField(overrides: { readonly symbolsAllowed?: boolean } = {}): {
  readonly onConfigChange: ReturnType<typeof vi.fn>;
  readonly onChange: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  const onConfigChange = vi.fn();
  render(
    <CredentialTemplateField
      label="Username template"
      value=""
      onChange={onChange}
      config={USERNAME_CONFIG}
      onConfigChange={onConfigChange}
      symbolsAllowed={overrides.symbolsAllowed ?? false}
      placeholder="camp1*"
    />,
  );
  return { onChange, onConfigChange };
}

describe('CredentialTemplateField', () => {
  it('holds the template text under its own label', () => {
    const { onChange } = renderField();
    const input = screen.getByLabelText('Username template');
    expect(input.getAttribute('placeholder')).toBe('camp1*');
    fireEvent.change(input, { target: { value: 'camp1*' } });
    expect(onChange).toHaveBeenCalledWith('camp1*');
  });

  it('opens the config dialog from its options control', () => {
    renderField();
    fireEvent.click(buttonNamed('Template options'));
    expect(buttonNamed('Use')).not.toBeNull();
  });

  it('offers no symbol group for a username alphabet', () => {
    renderField();
    fireEvent.click(buttonNamed('Template options'));
    expect(screen.queryByText(SPECIAL_LABEL)).toBeNull();
    expect(screen.queryByText(OPERATOR_LABEL)).toBeNull();
    expect(screen.getByText('Letters')).not.toBeNull();
    expect(screen.getByText('Numbers')).not.toBeNull();
  });

  it('offers both symbol groups when the caller allows them', () => {
    renderField({ symbolsAllowed: true });
    fireEvent.click(buttonNamed('Template options'));
    expect(screen.getByText(SPECIAL_LABEL)).not.toBeNull();
    expect(screen.getByText(OPERATOR_LABEL)).not.toBeNull();
  });
});

describe('GeneratorConfigDialog', () => {
  const CONFIG: GeneratorConfig = { ...USERNAME_CONFIG };

  function renderDialog(props: {
    readonly autoPreview?: boolean;
    readonly onUse?: () => void;
    readonly onConfigChange?: (config: GeneratorConfig) => void;
  } = {}): { readonly onOpenChange: ReturnType<typeof vi.fn> } {
    const onOpenChange = vi.fn();
    render(
      <GeneratorConfigDialog
        open
        onOpenChange={onOpenChange}
        title="Username options"
        config={CONFIG}
        onConfigChange={props.onConfigChange ?? (() => undefined)}
        onUse={props.onUse}
        autoPreview={props.autoPreview}
      />,
    );
    return { onOpenChange };
  }

  it('gates Use behind a first Generate unless the caller samples on open', () => {
    renderDialog();
    expect(buttonNamed('Use').disabled).toBe(true);
    fireEvent.click(buttonNamed('Generate'));
    expect(buttonNamed('Use').disabled).toBe(false);
  });

  it('samples on open when the caller asks for it', () => {
    renderDialog({ autoPreview: true });
    expect(buttonNamed('Use').disabled).toBe(false);
  });

  it('reports a config edit and closes with the accepted sample', () => {
    const onConfigChange = vi.fn();
    const onUse = vi.fn();
    const { onOpenChange } = renderDialog({ autoPreview: true, onUse, onConfigChange });

    fireEvent.change(screen.getByDisplayValue('8'), { target: { value: '200' } });
    expect(onConfigChange).toHaveBeenCalledWith({ ...CONFIG, length: 128 });

    fireEvent.click(buttonNamed('Use'));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse.mock.calls[0][0]).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
