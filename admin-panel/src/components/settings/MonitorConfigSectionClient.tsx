'use client';

import { useState, useCallback } from 'react';
import { Trash2, Play, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { toast } from 'sonner';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import { MonitorTargetForm } from './MonitorTargetForm';
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
  const toasts = useDictionary().toasts.monitor;
  const [targets, setTargets] = useState<MonitorTarget[]>(initialTargets);
  const [url, setUrl] = useState('');
  const [interval, setInterval_] = useState(60);
  const [timeout, setTimeout_] = useState(5);
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!url.trim()) {
      toast.error(toasts.errorTitle, { description: toasts.urlRequiredDescription });
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
        toast.success(toasts.addedTitle, { description: toasts.addedDescription });
      } else {
        toast.error(toasts.errorTitle, { description: result.error ?? toasts.failureDescription });
      }
    } finally {
      setAdding(false);
    }
  }, [url, interval, timeout, expectedStatus, toasts]);

  const handleRemove = useCallback(
    async (id: string) => {
      const result = await removeMonitorTarget(id);
      if (result.success) {
        setTargets((prev) => prev.filter((t) => t.id !== id));
        toast.success(toasts.removedTitle, { description: toasts.removedDescription });
      } else {
        toast.error(toasts.errorTitle, { description: result.error ?? toasts.failureDescription });
      }
    },
    [toasts],
  );

  const handleToggle = useCallback(
    async (id: string) => {
      const result = await toggleMonitorTarget(id);
      if (result.success && result.data) {
        setTargets((prev) =>
          prev.map((t) => (t.id === id ? (result.data as MonitorTarget) : t)),
        );
      } else {
        toast.error(toasts.errorTitle, { description: result.error ?? toasts.failureDescription });
      }
    },
    [toasts],
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
          // sonner exposes one publisher per severity, so the dynamic type maps to a branch.
          const description = interpolate(toasts.resultDescription, {
            status: d.status,
            expectedStatus: d.expectedStatus,
            latency: d.latency,
          });
          if (d.matched) toast.success(toasts.testOkTitle, { description });
          else toast.warning(toasts.testMismatchTitle, { description });
        } else {
          toast.error(toasts.testFailedTitle, {
            description: result.error ?? toasts.connectionErrorDescription,
          });
        }
      } finally {
        setTestingId(null);
      }
    },
    [toasts],
  );

  return (
    <div className="bg-card backdrop-blur-xl border border-border rounded-2xl p-6 space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Monitor Configuration</h2>
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
                className="flex size-11 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:text-foreground transition-colors"
                aria-label={target.enabled ? 'Disable target' : 'Enable target'}
              >
                {target.enabled ? (
                  <ToggleRight className="w-5 h-5 text-success" />
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
      <MonitorTargetForm
        url={url}
        interval={interval}
        timeout={timeout}
        expectedStatus={expectedStatus}
        adding={adding}
        onUrlChange={setUrl}
        onIntervalChange={setInterval_}
        onTimeoutChange={setTimeout_}
        onExpectedStatusChange={setExpectedStatus}
        onAdd={handleAdd}
      />
    </div>
  );
}
