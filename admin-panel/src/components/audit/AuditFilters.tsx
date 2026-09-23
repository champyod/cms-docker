'use client';

import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Card } from '@/components/core/Card';
import { Search } from 'lucide-react';
import type { AuditDict, AuditFilterValues } from './auditTypes';

interface AuditFiltersProps {
  dict: AuditDict;
  values: Required<Record<keyof AuditFilterValues, string>>;
  entities: string[];
  onValuesChange: (patch: Partial<Record<keyof AuditFilterValues, string>>) => void;
  onApply: () => void;
  onClear: () => void;
}

export function AuditFilters({
  dict,
  values,
  entities,
  onValuesChange,
  onApply,
  onClear,
}: AuditFiltersProps): React.JSX.Element {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[160px]">
          <label className="block text-xs font-medium text-muted-foreground mb-1">{dict.filters.entity}</label>
          <select
            value={values.entity}
            onChange={(e) => onValuesChange({ entity: e.target.value })}
            title={dict.filters.entity}
            className="h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <option value="">{dict.filters.allEntities}</option>
            {entities.map((ent) => (
              <option key={ent} value={ent}>{ent}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[140px]">
          <Input
            label={dict.filters.verb}
            value={values.verb}
            onChange={(e) => onValuesChange({ verb: e.target.value })}
            placeholder={dict.filters.verb}
          />
        </div>
        <div className="min-w-[120px]">
          <Input
            label={dict.filters.actorId}
            value={values.actorId}
            onChange={(e) => onValuesChange({ actorId: e.target.value })}
            placeholder="ID"
          />
        </div>
        <div className="min-w-[160px]">
          <Input
            label={dict.filters.fromDate}
            type="date"
            value={values.fromDate}
            onChange={(e) => onValuesChange({ fromDate: e.target.value })}
          />
        </div>
        <div className="min-w-[160px]">
          <Input
            label={dict.filters.toDate}
            type="date"
            value={values.toDate}
            onChange={(e) => onValuesChange({ toDate: e.target.value })}
          />
        </div>
        <div className="flex gap-2 pb-0.5">
          <Button variant="positive" size="sm" onClick={onApply} icon={Search}>
            {dict.filters.apply}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear}>
            {dict.filters.clear}
          </Button>
        </div>
      </div>
    </Card>
  );
}
