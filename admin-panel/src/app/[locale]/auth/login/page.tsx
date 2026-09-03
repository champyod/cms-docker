'use client';

import React, { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { Button } from '@/components/core/Button';
import { Lock, User, AlertCircle, ShieldCheck } from 'lucide-react';
import { getCaptchaState, login } from '@/app/actions/auth';
import { AuthBackground } from '@/components/core/PageBackground';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import type { CaptchaProvider } from '@/lib/captcha';

interface CaptchaUiState {
  required: boolean;
  enabled: boolean;
  provider: CaptchaProvider;
  siteKey: string;
}

declare global {
  interface Window {
    onCaptchaSuccess?: (token: string) => void;
    onCaptchaExpired?: () => void;
    turnstile?: { render: (el: string | HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void };
    hcaptcha?: { render: (el: string | HTMLElement, opts: Record<string, unknown>) => string; reset: () => void };
  }
}

function CaptchaWidget({
  provider,
  siteKey,
  onToken,
}: {
  provider: CaptchaProvider;
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (!siteKey || renderedRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const tryRender = () => {
      if (renderedRef.current) return;
      if (provider === 'turnstile' && window.turnstile && container) {
        container.innerHTML = '';
        try {
          window.turnstile.render(container, {
            sitekey: siteKey,
            callback: (token: string) => onToken(token),
            'expired-callback': () => onToken(''),
            'error-callback': () => onToken(''),
            theme: 'dark',
          });
          renderedRef.current = true;
        } catch {
          container.innerHTML = `<div class="cf-turnstile" data-sitekey="${siteKey}" data-callback="onCaptchaSuccess" data-expired-callback="onCaptchaExpired"></div>`;
        }
        return;
      }
      if (provider === 'hcaptcha' && window.hcaptcha && container) {
        container.innerHTML = '';
        try {
          window.hcaptcha.render(container, {
            sitekey: siteKey,
            callback: (token: string) => onToken(token),
            'expired-callback': () => onToken(''),
            'error-callback': () => onToken(''),
            theme: 'dark',
          });
          renderedRef.current = true;
        } catch {
          container.innerHTML = `<div class="h-captcha" data-sitekey="${siteKey}" data-callback="onCaptchaSuccess" data-expired-callback="onCaptchaExpired"></div>`;
        }
      }
    };

    const interval = window.setInterval(tryRender, 300);
    tryRender();
    return () => window.clearInterval(interval);
  }, [provider, siteKey, onToken]);

  if (provider === 'turnstile') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Security check required</span>
        </div>
        <div ref={containerRef} className="min-h-16 flex items-center justify-center">
          <div className="cf-turnstile" data-sitekey={siteKey} data-callback="onCaptchaSuccess" data-expired-callback="onCaptchaExpired" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>Security check required</span>
      </div>
      <div ref={containerRef} className="min-h-16 flex items-center justify-center">
        <div className="h-captcha" data-sitekey={siteKey} data-callback="onCaptchaSuccess" data-expired-callback="onCaptchaExpired" />
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [state, loginAction, pending] = useActionState(login, null);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaUi, setCaptchaUi] = useState<CaptchaUiState | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const fetchCaptchaState = useCallback(async (username?: string) => {
    try {
      const result = await getCaptchaState(username);
      if (!result.enabled) {
        setCaptchaUi(null);
        return;
      }
      setCaptchaUi({
        required: result.required,
        enabled: result.enabled,
        provider: result.provider,
        siteKey: result.siteKey,
      });
    } catch {
      setCaptchaUi(null);
    }
  }, []);

  useEffect(() => {
    void fetchCaptchaState();
  }, [fetchCaptchaState]);

  useEffect(() => {
    if (state?.captchaRequired) {
      setCaptchaUi({
        required: true,
        enabled: true,
        provider: (state.captchaProvider as CaptchaProvider) ?? 'turnstile',
        siteKey: state.captchaSiteKey ?? captchaUi?.siteKey ?? '',
      });
      const username = usernameRef.current?.value ?? '';
      if (username) void fetchCaptchaState(username);
    } else if (state?.error) {
      const username = usernameRef.current?.value ?? '';
      void fetchCaptchaState(username || undefined);
    }
  }, [state, captchaUi?.siteKey, fetchCaptchaState]);

  useEffect(() => {
    window.onCaptchaSuccess = (token: string) => setCaptchaToken(token);
    window.onCaptchaExpired = () => setCaptchaToken('');
    return () => {
      window.onCaptchaSuccess = undefined;
      window.onCaptchaExpired = undefined;
    };
  }, []);

  const needsCaptcha = Boolean(captchaUi?.required && captchaUi.siteKey) || Boolean(state?.captchaRequired && state.captchaSiteKey);
  const activeProvider: CaptchaProvider = (state?.captchaProvider as CaptchaProvider) ?? captchaUi?.provider ?? 'turnstile';
  const activeSiteKey = state?.captchaSiteKey ?? captchaUi?.siteKey ?? '';
  const showCaptcha = needsCaptcha && activeSiteKey.length > 0;

  useEffect(() => {
    if (!showCaptcha || !activeSiteKey) return;
    const existing = document.querySelector<HTMLScriptElement>(
      activeProvider === 'hcaptcha' ? 'script[data-captcha="hcaptcha"]' : 'script[data-captcha="turnstile"]'
    );
    if (existing) return;
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.dataset.captcha = activeProvider === 'hcaptcha' ? 'hcaptcha' : 'turnstile';
    script.src = activeProvider === 'hcaptcha' ? 'https://hcaptcha.com/1/api.js' : 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    document.head.appendChild(script);
  }, [showCaptcha, activeProvider, activeSiteKey]);

  const handleUsernameBlur = useCallback(() => {
    const username = usernameRef.current?.value?.trim() ?? '';
    if (username.length > 0) void fetchCaptchaState(username);
  }, [fetchCaptchaState]);

  return (
    <AuthBackground>
      <Card className="w-full max-w-md p-8">
        <Stack align="center" gap={8} className="mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Lock className="w-6 h-6 text-foreground" />
          </div>
          <Stack align="center" gap={2}>
            <Text variant="h2">Welcome Back</Text>
            <Text variant="muted">Sign in to access the admin panel</Text>
          </Stack>
        </Stack>

        <form action={loginAction}>
          <Stack gap={6}>
            {state?.error && (
              <Stack direction="row" align="center" gap={3} className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p>{state.error}</p>
              </Stack>
            )}

            <Input
              ref={usernameRef}
              name="username"
              label="Username"
              placeholder="admin"
              icon={<User className="w-4 h-4" />}
              required
              onBlur={handleUsernameBlur}
            />
            <Input
              name="password"
              label="Password"
              type="password"
              placeholder="••••••••"
              icon={<Lock className="w-4 h-4" />}
              required
            />

            {showCaptcha && (
              <>
                <CaptchaWidget provider={activeProvider} siteKey={activeSiteKey} onToken={setCaptchaToken} />
                <input type="hidden" name="captchaToken" value={captchaToken} />
                <input type="hidden" name="cf-turnstile-response" value={captchaToken} />
                <input type="hidden" name="h-captcha-response" value={captchaToken} />
              </>
            )}

            <Button type="submit" variant="primary" className="w-full" size="lg" loading={pending}>
              {pending ? "Signing In..." : "Sign In"}
            </Button>
          </Stack>
        </form>
      </Card>
    </AuthBackground>
  );
}
