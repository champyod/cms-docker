'use client';

import { useState, useTransition } from 'react';

import { applyWafSettings, restartWaf, saveWafSettings, type WafState } from '@/app/actions/securityWaf';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';

interface WafPanelProps {
  readonly state: WafState;
}

type WafFormField =
  | 'enabled'
  | 'ruleEngine'
  | 'responseBodyAccess'
  | 'paranoia'
  | 'anomalyInbound'
  | 'anomalyOutbound';

const ENGINE_OPTIONS = ['DetectionOnly', 'On'];
const RESPONSE_BODY_OPTIONS = ['Off', 'On', 'Force', 'Rejected'];

export function WafPanel({ state }: WafPanelProps): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<Record<WafFormField, string>>({
    enabled: state.settings.enabled ? '1' : '0',
    ruleEngine: state.settings.ruleEngine,
    responseBodyAccess: state.settings.responseBodyAccess,
    paranoia: String(state.settings.paranoia),
    anomalyInbound: String(state.settings.anomalyInbound),
    anomalyOutbound: String(state.settings.anomalyOutbound),
  });

  const isBlocked = pending || reason.trim().length === 0;

  function run(action: () => Promise<{ success: boolean; error?: string; message?: string }>): void {
    startTransition(async () => {
      const result = await action();
      setFeedback(result.success ? (result.message ?? 'Done') : (result.error ?? 'Failed'));
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-white/60">Container</dt>
            <dd className="font-mono text-sm">{state.containerStatus ?? 'not running'}</dd>
          </div>
          <div>
            <dt className="text-sm text-white/60">Alerts parsed</dt>
            <dd className="font-mono text-sm">{state.alerts.length}</dd>
          </div>
          <div>
            <dt className="text-sm text-white/60">Unparsed log lines</dt>
            <dd className="font-mono text-sm">{state.skippedAlertLines}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Settings</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Enabled
            <select
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
              value={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.value })}
            >
              <option value="0">0 — off</option>
              <option value="1">1 — on</option>
            </select>
          </label>
          <label className="text-sm">
            SecRuleEngine
            <select
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
              value={form.ruleEngine}
              onChange={(event) => setForm({ ...form, ruleEngine: event.target.value })}
            >
              {ENGINE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            SecResponseBodyAccess
            <select
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
              value={form.responseBodyAccess}
              onChange={(event) => setForm({ ...form, responseBodyAccess: event.target.value })}
            >
              {RESPONSE_BODY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Paranoia level (1-4)"
            value={form.paranoia}
            onChange={(event) => setForm({ ...form, paranoia: event.target.value })}
          />
          <Input
            label="Inbound anomaly threshold"
            value={form.anomalyInbound}
            onChange={(event) => setForm({ ...form, anomalyInbound: event.target.value })}
          />
          <Input
            label="Outbound anomaly threshold"
            value={form.anomalyOutbound}
            onChange={(event) => setForm({ ...form, anomalyOutbound: event.target.value })}
          />
          <Input
            label="Reason (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button loading={pending} disabled={isBlocked} onClick={() => run(() => saveWafSettings(form, reason))}>
            Save settings
          </Button>
          <Button variant="secondary" loading={pending} disabled={isBlocked} onClick={() => run(() => applyWafSettings(reason))}>
            Sync and recreate WAF
          </Button>
          <Button variant="secondary" loading={pending} disabled={isBlocked} onClick={() => run(() => restartWaf(reason))}>
            Restart WAF
          </Button>
        </div>
        {feedback !== null && <p className="mt-3 text-sm text-white/70">{feedback}</p>}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Latest alerts</h2>
        {state.alerts.length === 0 ? (
          <p className="text-sm text-white/60">No parsed alerts. The WAF writes JSON audit lines when it runs.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {state.alerts.map((alert) => (
              <li key={alert.id} className="rounded-xl border border-white/10 p-3">
                <p className="font-mono text-xs text-white/70">
                  {alert.clientIp ?? 'unknown ip'} → {alert.uri ?? 'unknown uri'}
                </p>
                <p className="mt-1">
                  rules {alert.ruleIds.join(', ') || 'none'} · score {alert.anomalyScore ?? '—'} ·{' '}
                  {alert.blocked ? 'blocked' : 'detected'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
