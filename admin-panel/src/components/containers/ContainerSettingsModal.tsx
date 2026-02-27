'use client';

import { useState } from 'react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { X, Settings, Power, RotateCcw, Bell } from 'lucide-react';
import { updateContainerConfig, resetRestartCount } from '@/app/actions/containerConfig';
import { useToast } from '@/components/providers/ToastProvider';

interface ContainerSettingsModalProps {
  containerId: string;
  containerName: string;
  config: {
    autoRestart: boolean;
    maxRestarts: number;
    currentRestarts: number;
    discordNotifications: boolean;
  };
  onClose: () => void;
  onUpdate: () => void;
}

export function ContainerSettingsModal({
  containerId,
  containerName,
  config,
  onClose,
  onUpdate
}: ContainerSettingsModalProps) {
  const [autoRestart, setAutoRestart] = useState(config.autoRestart);
  const [maxRestarts, setMaxRestarts] = useState(config.maxRestarts);
  const [discordNotifications, setDiscordNotifications] = useState(config.discordNotifications ?? true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  const handleSave = async () => {
    setSaving(true);
    const res = await updateContainerConfig(containerId, {
      autoRestart,
      maxRestarts,
      discordNotifications,
    });

    if (res.success) {
      addToast({ title: 'Success', message: 'Container settings updated', type: 'success' });
      onUpdate();
      onClose();
    } else {
      addToast({ title: 'Error', message: res.error, type: 'error' });
    }
    setSaving(false);
  };

  const handleReset = async () => {
    const res = await resetRestartCount(containerId);
    if (res.success) {
      addToast({ title: 'Success', message: 'Restart count reset to 0', type: 'success' });
      onUpdate();
      onClose();
    } else {
      addToast({ title: 'Error', message: res.error, type: 'error' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="glass-card border-white/10 max-w-lg w-full">
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-600/20 rounded-lg">
              <Settings className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Container Settings</h2>
              <p className="text-sm text-neutral-400 font-mono">{containerName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-neutral-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Auto-Restart Toggle */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-bold text-white flex items-center gap-2">
                  <Power className="w-4 h-4 text-emerald-400" />
                  Auto-Restart Policy
                </label>
                <p className="text-xs text-neutral-400 mt-1">
                  Automatically restart container on failure
                </p>
              </div>
              <button
                onClick={() => setAutoRestart(!autoRestart)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  autoRestart ? 'bg-emerald-600' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    autoRestart ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {!autoRestart && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-xs text-amber-300">
                  ⚠️ Container will NOT restart automatically on failure. You must start it manually via the UI.
                </p>
              </div>
            )}
          </div>

          {/* Max Restarts Limit */}
          <div className="space-y-3">
            <label className="text-sm font-bold text-white flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-indigo-400" />
              Maximum Restart Attempts
            </label>
            <p className="text-xs text-neutral-400">
              Container will stop auto-restarting after this many failed attempts
            </p>
            <input
              type="number"
              min="1"
              max="20"
              value={maxRestarts}
              onChange={(e) => setMaxRestarts(parseInt(e.target.value) || 5)}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            />
            <p className="text-xs text-neutral-500">
              Recommended: 5 attempts. Range: 1-20.
            </p>
          </div>

          {/* Discord Notifications */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-bold text-white flex items-center gap-2">
                  <Bell className="w-4 h-4 text-blue-400" />
                  Discord Notifications
                </label>
                <p className="text-xs text-neutral-400 mt-1">
                  Send container events (start/stop/die/restart) to Discord webhook
                </p>
              </div>
              <button
                onClick={() => setDiscordNotifications(!discordNotifications)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  discordNotifications ? 'bg-blue-600' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    discordNotifications ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {!discordNotifications && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <p className="text-xs text-amber-300">
                  ⚠️ Discord notifications disabled. Container events will not be sent to webhook.
                </p>
              </div>
            )}
          </div>

          {/* Current Status */}
          <div className="bg-black/40 border border-white/5 rounded-lg p-4 space-y-2">
            <div className="text-xs font-bold text-neutral-400">CURRENT STATUS</div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-300">Auto-Restart</span>
              <span className={`text-sm font-bold ${config.autoRestart ? 'text-emerald-400' : 'text-neutral-500'}`}>
                {config.autoRestart ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-300">Restart Count</span>
              <span className={`text-sm font-bold ${config.currentRestarts >= config.maxRestarts ? 'text-red-400' : 'text-indigo-400'}`}>
                {config.currentRestarts} / {config.maxRestarts}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-300">Discord Alerts</span>
              <span className={`text-sm font-bold ${config.discordNotifications ? 'text-blue-400' : 'text-neutral-500'}`}>
                {config.discordNotifications ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
            {config.currentRestarts >= config.maxRestarts && (
              <div className="bg-red-500/10 border border-red-500/20 rounded p-2 mt-2">
                <p className="text-xs text-red-300">
                  🚨 Restart limit reached! Container will not auto-restart until count is reset.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-white/5 flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            onClick={handleReset}
            className="border-amber-500/20 text-amber-400 hover:bg-amber-500/10"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset Restart Count
          </Button>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={onClose}
              className="border-white/10 text-neutral-300 hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
