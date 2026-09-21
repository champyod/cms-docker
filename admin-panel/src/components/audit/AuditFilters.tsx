'use client';

import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { Search } from 'lucide-react';
import type { AuditDict } from './audit-dict';

interface AuditFiltersProps {
  dict: AuditDict;
  entities: string[];
  entityFilter: string;
  verbFilter: string;
  actorIdFilter: string;
  resultFilter: string;
  searchFilter: string;
  fromDateFilter: string;
  toDateFilter: string;
  onEntityFilter: (value: string) => void;
  onVerbFilter: (value: string) => void;
  onActorIdFilter: (value: string) => void;
  onResultFilter: (value: string) => void;
  onSearchFilter: (value: string) => void;
  onFromDateFilter: (value: string) => void;
  onToDateFilter: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}

/** Filter card for the audit log: entity, verb, actor, result, search and dates. */
export function AuditFilters({
  dict,
  entities,
  entityFilter,
  verbFilter,
  actorIdFilter,
  resultFilter,
  searchFilter,
  fromDateFilter,
  toDateFilter,
  onEntityFilter,
  onVerbFilter,
  onActorIdFilter,
  onResultFilter,
  onSearchFilter,
  onFromDateFilter,
  onToDateFilter,
  onApply,
  onClear,
}: AuditFiltersProps): React.JSX.Element {
  const selectClassName =
    'h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40">
          <label className="block text-xs font-medium text-muted-foreground mb-1">{dict.filters.entity}</label>
          <select
            value={entityFilter}
            onChange={(e) => onEntityFilter(e.target.value)}
            title={dict.filters.entity}
            className={selectClassName}
          >
            <option value="">{dict.filters.allEntities}</option>
            {entities.map((ent) => (
              <option key={ent} value={ent}>{ent}</option>
            ))}
          </select>
        </div>
        <div className="min-w-35">
          <Input
            label={dict.filters.verb}
            value={verbFilter}
            onChange={(e) => onVerbFilter(e.target.value)}
            placeholder={dict.filters.verb}
          />
        </div>
        <div className="min-w-30">
          <Input
            label={dict.filters.actorId}
            value={actorIdFilter}
            onChange={(e) => onActorIdFilter(e.target.value)}
            placeholder="ID"
          />
        </div>
        <div className="min-w-40">
          <label className="block text-xs font-medium text-muted-foreground mb-1">{dict.filters.result}</label>
          <select
            value={resultFilter}
            onChange={(e) => onResultFilter(e.target.value)}
            title={dict.filters.result}
            className={selectClassName}
          >
            <option value="">{dict.filters.allResults}</option>
            <option value="success">success</option>
            <option value="failure">failure</option>
          </select>
        </div>
        <div className="min-w-45">
          <Input
            label={dict.filters.search}
            value={searchFilter}
            onChange={(e) => onSearchFilter(e.target.value)}
            placeholder={dict.filters.searchPlaceholder}
          />
        </div>
        <div className="min-w-40">
          <Input
            label={dict.filters.fromDate}
            type="date"
            value={fromDateFilter}
            onChange={(e) => onFromDateFilter(e.target.value)}
          />
        </div>
        <div className="min-w-40">
          <Input
            label={dict.filters.toDate}
            type="date"
            value={toDateFilter}
            onChange={(e) => onToDateFilter(e.target.value)}
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
