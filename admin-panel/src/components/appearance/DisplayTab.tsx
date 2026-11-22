'use client';

import { Tabs } from '@/components/core/Tabs';
import { useDisplayDensity } from '@/hooks/useDisplayDensity';
import { useHighContrast } from '@/hooks/useHighContrast';
import type { DensityPreference, TextSizePreference } from '@/lib/display-density';
import type { ContrastPreference } from '@/lib/high-contrast';

const DENSITY_OPTIONS: { key: DensityPreference; label: string }[] = [
  { key: 'comfortable', label: 'Comfortable' },
  { key: 'compact', label: 'Compact' },
];

const TEXT_SIZE_OPTIONS: { key: TextSizePreference; label: string }[] = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
];

const CONTRAST_OPTIONS: { key: ContrastPreference; label: string }[] = [
  { key: 'standard', label: 'Standard' },
  { key: 'high', label: 'High' },
];

/**
 * The three choices that change this screen only.
 *
 * WHY no card and no heading: the settings layout frames the group and states its scope, so the
 * panel only carries the three controls and what each one does.
 */
export function DisplayTab(): React.JSX.Element {
  const { display, setDisplay } = useDisplayDensity();
  const { highContrast, setHighContrast } = useHighContrast();
  const current = display ?? { density: 'comfortable' as const, textSize: 'medium' as const };
  const contrast: ContrastPreference = highContrast === true ? 'high' : 'standard';
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Density</h3>
          <p className="mt-1 text-xs text-muted-foreground">Compact shrinks padding and gaps panel-wide. Applies instantly. (Stored on this device)</p>
        </div>
        <Tabs
          items={DENSITY_OPTIONS.map((option) => ({ id: option.key, label: option.label }))}
          activeId={current.density}
          ariaLabel="Density"
          onSelect={(id) => setDisplay({ ...current, density: id as DensityPreference })}
        />
      </div>
      <div className="space-y-4 border-t border-border pt-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Text size</h3>
          <p className="mt-1 text-xs text-muted-foreground">Spacing follows the font size automatically. Applies instantly. (Stored on this device)</p>
        </div>
        <Tabs
          items={TEXT_SIZE_OPTIONS.map((option) => ({ id: option.key, label: option.label }))}
          activeId={current.textSize}
          ariaLabel="Text size"
          onSelect={(id) => setDisplay({ ...current, textSize: id as TextSizePreference })}
        />
      </div>
      <div className="space-y-4 border-t border-border pt-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Contrast</h3>
          <p className="mt-1 text-xs text-muted-foreground">High outlines every card and field and makes status colours solid. Applies instantly. (Stored on this device)</p>
        </div>
        <Tabs
          items={CONTRAST_OPTIONS.map((option) => ({ id: option.key, label: option.label }))}
          activeId={contrast}
          ariaLabel="Contrast"
          onSelect={(id) => setHighContrast(id as ContrastPreference)}
        />
      </div>
    </div>
  );
}
