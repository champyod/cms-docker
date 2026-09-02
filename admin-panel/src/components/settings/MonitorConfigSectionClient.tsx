'use client';

import { useState, useCallback } from 'react';
import { Plus, Trash2, Play, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { useToast } from '@/components/providers/ToastProvider';
import {
  addMonitorTarget,
  removeMonitorTarget,
  toggleMonitorTarget,
  testMonitorTarget,
} from '@/app/actions/monitor';

interface MonitorTarget {
  id: string;
  url: string;
  interval: number;
  timeout: number;
  expectedStatus: number;
  alertDiscord: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface MonitorConfigSectionClientProps {
  initialTargets: MonitorTarget[];
}

export function MonitorConfigSectionClient({
  initialTargets,
}: MonitorConfigSectionClientProps): React.ReactElement {
  const [targets, setTargets] = useState<MonitorTarget[]>(initialTargets);
  const [url, setUrl] = useState('');
  const [interval, setInterval_] = useState(60);
  const [timeout, setTimeout_] = useState(5);
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { addToast } = useToast();

  const handleAdd = useCallback(async () => {
    if (!url.trim()) {
      addToast({ type: 'error', title: 'Error', message: 'URL is required' });
      return;
    }
    setAdding(true);
    try {
      const result = await addMonitorTarget({
        url: url.trim(),
        interval,
        timeout,
        expectedStatus,
      });
      if (result.success && result.data) {
        setTargets((prev) => [result.data as MonitorTarget, ...prev]);
        setUrl('');
        setInterval_(60);
        setTimeout_(5);
        setExpectedStatus(200);
        addToast({ type: 'success', title: 'Added', message: 'Monitor target added' });
      } else {
        addToast({ type: 'error', title: 'Error', message: result.error ?? 'Failed' });
      }
    } finally {
      setAdding(false);
    }
  }, [url, interval, timeout, expectedStatus, addToast]);

  const handleRemove = useCallback(
    async (id: string) => {
      const result = await removeMonitorTarget(id);
      if (result.success) {
        setTargets((prev) => prev.filter((t) => t.id !== id));
        addToast({ type: 'success', title: 'Removed', message: 'Target removed' });
      } else {
        addToast({ type: 'error', title: 'Error', message: result.error ?? 'Failed' });
      }
    },
    [addToast],
  );

  const handleToggle = useCallback(
    async (id: string) => {
      const result = await toggleMonitorTarget(id);
      if (result.success && result.data) {
        setTargets((prev) =>
          prev.map((t) => (t.id === id ? (result.data as MonitorTarget) : t)),
        );
      } else {
        addToast({ type: 'error', title: 'Error', message: result.error ?? 'Failed' });
      }
    },
    [addToast],
  );

  const handleTest = useCallback(
    async (id: string) => {
      setTestingId(id);
      try {
        const result = await testMonitorTarget(id);
        if (result.success && result.data) {
          const d = result.data as {
            status: number;
            expectedStatus: number;
            matched: boolean;
            latency: number;
          };
          addToast({
            type: d.matched ? 'success' : 'warning',
            title: d.matched ? 'OK' : 'Mismatch',
            message: `HTTP ${d.status} (expected ${d.expectedStatus}) — ${d.latency}ms`,
          });
        } else {
          addToast({ type: 'error', title: 'Test Failed', message: result.error ?? 'Connection error' });
        }
      } finally {
        setTestingId(null);
      }
    },
    [addToast],
  );

  return (
    <div className="bg-card backdrop-blur-xl border border-border rounded-2xl p-6 space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Monitor Configuration</h2>

      {/* Target List */}
      {targets.length === 0 ? (
        <p className="text-neutral-400 text-sm">No monitor targets configured.</p>
      ) : (
        <div className="space-y-3">
          {targets.map((target) => (
            <Card
              key={target.id}
              className={`flex items-center gap-4 p-4 bg-black/40 border border-border rounded-xl ${
                !target.enabled ? 'opacity-50' : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate font-mono">{target.url}</p>
                <p className="text-xs text-neutral-400">
                  {target.interval}s interval · {target.timeout}s timeout · HTTP{' '}
                  {target.expectedStatus}
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleToggle(target.id)}
                className="text-neutral-400 hover:text-foreground transition-colors"
                aria-label={target.enabled ? 'Disable target' : 'Enable target'}
              >
                {target.enabled ? (
                  <ToggleRight className="w-5 h-5 text-emerald-400" />
                ) : (
                  <ToggleLeft className="w-5 h-5" />
                )}
              </button>

              <Button
                variant="ghost"
                size="sm"
                loading={testingId === target.id}
                onClick={() => handleTest(target.id)}
              >
                <Play className="w-3.5 h-3.5 mr-1" />
                Test
              </Button>

              <Button
                variant="negative"
                size="sm"
                onClick={() => handleRemove(target.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </Card>
          ))}
        </div>
      )}

      {/* Add Form */}
      <div className="bg-black/40 border border-border rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-medium text-foreground">Add Target</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Input
            label="URL"
            placeholder="https://example.com/health"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="col-span-1 md:col-span-2 lg:col-span-4"
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground ml-1">Interval (s)</label>
            <select
              value={interval}
              onChange={(e) => setInterval_(Number(e.target.value))}
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
              onChange={(e) => setTimeout_(Number(e.target.value))}
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
              onChange={(e) => setExpectedStatus(Number(e.target.value))}
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
              onClick={handleAdd}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
