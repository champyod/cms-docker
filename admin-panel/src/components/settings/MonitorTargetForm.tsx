'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';

interface MonitorTargetFormProps {
  url: string;
  interval: number;
  timeout: number;
  expectedStatus: number;
  adding: boolean;
  onUrlChange: (value: string) => void;
  onIntervalChange: (value: number) => void;
  onTimeoutChange: (value: number) => void;
  onExpectedStatusChange: (value: number) => void;
  onAdd: () => void;
}

export function MonitorTargetForm({
  url,
  interval,
  timeout,
  expectedStatus,
  adding,
  onUrlChange,
  onIntervalChange,
  onTimeoutChange,
  onExpectedStatusChange,
  onAdd,
}: MonitorTargetFormProps): React.JSX.Element {
  return (
    <div className="bg-black/40 border border-border rounded-xl p-4 space-y-4">
      <h3 className="text-sm font-medium text-foreground">Add Target</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Input
          label="URL"
          placeholder="https://example.com/health"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          className="col-span-1 md:col-span-2 lg:col-span-4"
        />
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground ml-1">Interval (s)</label>
          <select
            value={interval}
            onChange={(e) => onIntervalChange(Number(e.target.value))}
            className="w-full h-10 px-3 bg-black/40 border border-border rounded-xl text-sm text-foreground"
          >
            <option value={30}>30</option>
            <option value={60}>60</option>
            <option value={120}>120</option>
            <option value={300}>300</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground ml-1">Timeout (s)</label>
          <select
            value={timeout}
            onChange={(e) => onTimeoutChange(Number(e.target.value))}
            className="w-full h-10 px-3 bg-black/40 border border-border rounded-xl text-sm text-foreground"
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={30}>30</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground ml-1">Expected Status</label>
          <select
            value={expectedStatus}
            onChange={(e) => onExpectedStatusChange(Number(e.target.value))}
            className="w-full h-10 px-3 bg-black/40 border border-border rounded-xl text-sm text-foreground"
          >
            <option value={200}>200</option>
            <option value={201}>201</option>
            <option value={204}>204</option>
            <option value={301}>301</option>
          </select>
        </div>
        <div className="flex items-end">
          <Button
            variant="positive"
            loading={adding}
            onClick={onAdd}
            className="w-full"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
