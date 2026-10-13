'use client';

import { Search } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import type { NotificationsCopy } from './alertColumns';

export interface AlertCentreFilters {
  readonly search?: string;
  readonly result?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

interface AlertFiltersBarProps extends AlertCentreFilters {
  readonly copy: NotificationsCopy;
  readonly onSearch: (value: string) => void;
  readonly onResult: (value: string) => void;
  readonly onFromDate: (value: string) => void;
  readonly onToDate: (value: string) => void;
  readonly onApply: () => void;
  readonly onClear: () => void;
}

interface ResultSelectProps {
  readonly copy: NotificationsCopy;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

interface DateRangeFieldsProps {
  readonly copy: NotificationsCopy;
  readonly fromDate: string;
  readonly toDate: string;
  readonly onFromDate: (value: string) => void;
  readonly onToDate: (value: string) => void;
}

const SELECT_CLASS =
  'h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

function ResultSelect({ copy, value, onChange }: ResultSelectProps): React.JSX.Element {
  return (
    <div className="min-w-40">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{copy.filters.result}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        title={copy.filters.result}
        className={SELECT_CLASS}
      >
        <option value="">{copy.filters.allResults}</option>
        <option value="success">success</option>
        <option value="failure">failure</option>
      </select>
    </div>
  );
}

function DateRangeFields({ copy, fromDate, toDate, onFromDate, onToDate }: DateRangeFieldsProps): React.JSX.Element {
  return (
    <>
      <div className="min-w-40">
        <Input
          label={copy.filters.fromDate}
          type="date"
          value={fromDate}
          onChange={(event) => onFromDate(event.target.value)}
        />
      </div>
      <div className="min-w-40">
        <Input
          label={copy.filters.toDate}
          type="date"
          value={toDate}
          onChange={(event) => onToDate(event.target.value)}
        />
      </div>
    </>
  );
}

/** The history's filter card: the free-text search, the result and the day range the reader set. */
export function AlertFiltersBar({
  copy,
  search,
  result,
  fromDate,
  toDate,
  onSearch,
  onResult,
  onFromDate,
  onToDate,
  onApply,
  onClear,
}: AlertFiltersBarProps): React.JSX.Element {
  return (
    <Card className="p-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        <div className="min-w-45">
          <Input
            label={copy.filters.search}
            value={search ?? ''}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={copy.filters.searchPlaceholder}
          />
        </div>
        <ResultSelect copy={copy} value={result ?? ''} onChange={onResult} />
        <DateRangeFields
          copy={copy}
          fromDate={fromDate ?? ''}
          toDate={toDate ?? ''}
          onFromDate={onFromDate}
          onToDate={onToDate}
        />
        <div className="flex gap-2 pb-0.5">
          <Button variant="positive" size="sm" type="submit" icon={Search}>
            {copy.filters.apply}
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onClear}>
            {copy.filters.clear}
          </Button>
        </div>
      </form>
    </Card>
  );
}
