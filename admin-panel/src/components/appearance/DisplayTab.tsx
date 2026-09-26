'use client';

import { Card } from '@/components/core/Card';
import { Tabs } from '@/components/core/Tabs';
import { useDisplayDensity } from '@/hooks/useDisplayDensity';
import type { DensityPreference, TextSizePreference } from '@/lib/display-density';

const DENSITY_OPTIONS: { key: DensityPreference; label: string }[] = [
  { key: 'comfortable', label: 'Comfortable' },
  { key: 'compact', label: 'Compact' },
];

const TEXT_SIZE_OPTIONS: { key: TextSizePreference; label: string }[] = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
];

export function DisplayTab(): React.JSX.Element {
  const { display, setDisplay } = useDisplayDensity();
  const current = display ?? { density: 'comfortable' as const, textSize: 'medium' as const };
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Density</h2>
          <p className="text-xs text-muted-foreground mt-1">Compact shrinks padding and gaps panel-wide. Applies instantly.</p>
        </div>
        <Tabs
          items={DENSITY_OPTIONS.map((option) => ({ id: option.key, label: option.label }))}
          activeId={current.density}
          ariaLabel="Density"
          onSelect={(id) => setDisplay({ ...current, density: id as DensityPreference })}
        />
      </Card>
      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Text size</h2>
          <p className="text-xs text-muted-foreground mt-1">Spacing follows the font size automatically. Applies instantly.</p>
        </div>
        <Tabs
          items={TEXT_SIZE_OPTIONS.map((option) => ({ id: option.key, label: option.label }))}
          activeId={current.textSize}
          ariaLabel="Text size"
          onSelect={(id) => setDisplay({ ...current, textSize: id as TextSizePreference })}
        />
      </Card>
    </div>
  );
}
